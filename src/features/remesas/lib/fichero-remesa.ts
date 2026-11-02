import { createHash } from 'node:crypto'

/**
 * El fichero de cada versión de una remesa, guardado (R-1, `20261220120000`; spec
 * `docs/specs/altas-serie.md`, «Reabrir una remesa»). Se guarda la primera vez que sale y, desde
 * ahí, cada descarga de esa versión sirve el guardado, byte a byte: generado otra vez, podría
 * llevar otro IBAN (`get_mandatos_remesa` toma el mandato activo en cada descarga).
 *
 * Aquí está la decisión, con sus dependencias inyectadas (la ruta del XML las conecta a Supabase):
 *  - con la versión ya guardada, se sirve la guardada, comprobando su huella;
 *  - sin ella, se genera con la marca (la que hay o, si no hay, la de ahora, redondeada al
 *    segundo como el `MsgId`), se sube sin sobrescribir y se registra; la base pone la marca y el
 *    registro en una transacción. Si el registro no entra, lo subido se borra.
 */

/**
 * Un adeudo del fichero, como lo registra la base (sin IBAN ni nombres). Alias y no interfaz: va
 * como `Json` a la RPC, y una interfaz no tiene firma de índice.
 */
export type AdeudoFichero = {
  recibo_id: string
  end_to_end_id: string
  importe_centimos: number
  mndt_id: string
}

/** El fichero generado de una versión. */
export interface FicheroGenerado {
  xml: string
  msgId: string
  adeudos: AdeudoFichero[]
}

/** La versión guardada, como la devuelve `fichero_remesa_vigente`. */
export interface VersionGuardada {
  ruta: string
  sha256: string
}

/** Un fallo de la descarga: el código va al cliente, que lo traduce. */
export interface FalloFichero {
  status: number
  body: { error: string; familias?: string[] }
}

export type ResultadoFichero = { xml: string } | FalloFichero

export interface DepsFichero {
  /** La versión guardada de la marca actual; `'error'` si la lectura falla. */
  vigente(): Promise<VersionGuardada | null | 'error'>
  /** Genera el fichero con esa marca; `null` solo comprueba que sale (la hora no importa). */
  generar(marca: string | null): Promise<FicheroGenerado | FalloFichero>
  /** Sube sin sobrescribir: `'existe'` si ya hay un objeto en esa ruta. */
  subir(ruta: string, xml: string): Promise<'ok' | 'existe' | 'error'>
  /** El contenido guardado; `null` si no se puede leer. */
  bajar(ruta: string): Promise<string | null>
  /** Borra lo subido que no llegó a registrarse. Si falla, lo recoge el barrido de huérfanos. */
  borrar(ruta: string): Promise<void>
  /** `registrar_fichero_remesa`: la marca y el registro, en una transacción. */
  registrar(v: {
    marca: string
    msgId: string
    sha256: string
    ruta: string
    adeudos: AdeudoFichero[]
  }): Promise<{ ok: true } | { ok: false; hint: string | null }>
  ahora(): Date
}

/** La ruta del fichero en el bucket privado: la misma que exige la base. */
export function rutaFicheroRemesa(centroId: string, remesaId: string, msgId: string): string {
  return `${centroId}/${remesaId}/${msgId}.xml`
}

/** La huella del fichero, sobre sus bytes UTF-8, en hexadecimal (64). */
export function sha256Hex(xml: string): string {
  return createHash('sha256').update(xml, 'utf8').digest('hex')
}

/**
 * La marca de una versión nueva: la hora del servidor sin milisegundos. El `MsgId` va al segundo,
 * así que dos marcas del mismo segundo darían el mismo `MsgId` con otra marca en la base.
 */
export function marcaDeAhora(ahora: Date): string {
  const d = new Date(ahora.getTime())
  d.setUTCMilliseconds(0)
  return d.toISOString()
}

function fallo(status: number, error: string): FalloFichero {
  return { status, body: { error } }
}

function esFallo(r: FicheroGenerado | FalloFichero): r is FalloFichero {
  return 'status' in r
}

/** Sirve la versión guardada si su contenido es el que se registró. */
async function servirGuardada(deps: DepsFichero, v: VersionGuardada): Promise<ResultadoFichero> {
  const xml = await deps.bajar(v.ruta)
  if (xml === null) return fallo(500, 'xml_failed')
  // Lo guardado es la prueba de lo que se pidió al banco: si no es lo registrado, no se sirve.
  if (sha256Hex(xml) !== v.sha256) return fallo(500, 'fichero_alterado')
  return { xml }
}

/** Genera la versión de esa marca, la sube y la registra. */
async function guardarVersion(
  deps: DepsFichero,
  remesa: { id: string; centroId: string },
  marca: string
): Promise<ResultadoFichero> {
  const g = await deps.generar(marca)
  if (esFallo(g)) return g

  const ruta = rutaFicheroRemesa(remesa.centroId, remesa.id, g.msgId)
  const subida = await deps.subir(ruta, g.xml)
  // Otra descarga de la misma versión está a medias: la ruta es suya, y no se toca.
  if (subida === 'existe') return fallo(409, 'descarga_en_curso')
  if (subida === 'error') return fallo(500, 'xml_failed')

  const sha256 = sha256Hex(g.xml)
  const r = await deps.registrar({ marca, msgId: g.msgId, sha256, ruta, adeudos: g.adeudos })
  if (r.ok) return { xml: g.xml }

  // Sin registro no se sirve nada, y lo subido no se queda.
  await deps.borrar(ruta)
  if (r.hint === 'marca_distinta' || r.hint === 'ya_guardado') {
    // Otra descarga fijó la versión antes: vale la suya.
    const v = await deps.vigente()
    if (v === 'error') return fallo(500, 'xml_failed')
    return v ? servirGuardada(deps, v) : fallo(409, 'descarga_en_curso')
  }
  if (r.hint === 'recibos_cambiaron') return fallo(409, 'remesa_cambio')
  return fallo(500, 'xml_failed')
}

/**
 * El fichero de la versión vigente de una remesa: el guardado o, la primera vez, el que se genera,
 * guarda y registra. Sin marca, antes de marcar se comprueba que el fichero sale, para no cerrar
 * una remesa con un 422.
 */
export async function obtenerFicheroRemesa(
  deps: DepsFichero,
  remesa: { id: string; centroId: string; marca: string | null }
): Promise<ResultadoFichero> {
  if (remesa.marca) {
    const v = await deps.vigente()
    if (v === 'error') return fallo(500, 'xml_failed')
    if (v) return servirGuardada(deps, v)
    // Una marca sin versión guardada (de antes de esta pieza): se guarda la de esa marca.
    return guardarVersion(deps, remesa, remesa.marca)
  }
  const previa = await deps.generar(null)
  if (esFallo(previa)) return previa
  return guardarVersion(deps, remesa, marcaDeAhora(deps.ahora()))
}
