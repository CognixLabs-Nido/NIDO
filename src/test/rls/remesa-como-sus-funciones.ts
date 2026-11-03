import { execFileSync } from 'node:child_process'

import { serviceClient } from './setup'

/**
 * La marca y el envío de una remesa, y el recibo enviado al banco, puestos como los ponen sus
 * funciones (FICCIÓN DE LOS TESTS).
 *
 * Desde `20261221120000` dos cosas de una remesa solo las pone su función, con un marcador local,
 * y ni la sesión ni service_role pueden por otro camino:
 *  - la marca del fichero (`fichero_generado_at`), `registrar_fichero_remesa` con
 *    `app.registrar_fichero` (trigger `remesas_marca_solo_registro`);
 *  - el paso a enviada, `marcar_remesa_enviada` con `app.marcar_remesa_enviada` (trigger
 *    `remesas_enviada_solo_por_marcar`).
 * Y desde `20261222120000`, una del recibo: el paso a `enviado_banco`, que solo da
 * `marcar_remesa_enviada`, recibo a recibo, con `app.marcar_recibo_enviado` = el id del recibo
 * (trigger `recibos_dinero_solo_por_funcion`). Desde `20261223120000`, todo el circuito del recibo:
 * nace en borrador, y validar, devolver, cobrar a mano y volver a borrador solo los da su función,
 * cada una con su marcador (`insertarRecibos`, `prepararRecibo`). Y para el caso que separa dos
 * defensas solapadas, `intentarConMarcador`.
 *
 * Los tests que necesitan una remesa o un recibo así sin pasar por la función entera (subir el
 * fichero, los adeudos con su mandato), con una marca de hace años o con un recibo enviado fuera de
 * toda remesa, lo preparan aquí: como `postgres`, sin JWT, por psql
 * contra la BD efímera del CI (`DB_URL`, que `rls-local.yml` exporta con `supabase status -o env`),
 * con el mismo marcador. La app no tiene este camino.
 *
 * Fuera del CI no hay `DB_URL` y falla: estos tests solo corren contra la BD efímera.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function comoPostgres(remesaId: string, marcador: string, set: string): void {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: la remesa solo se prepara así en la BD efímera del CI')
  if (!UUID.test(remesaId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${remesaId}`)
  const sql = [
    'BEGIN;',
    `SELECT set_config('${marcador}', '${remesaId}', true);`,
    `UPDATE public.remesas SET ${set} WHERE id = '${remesaId}' RETURNING 'hecho';`,
    'COMMIT;',
  ].join('\n')
  // Por la entrada estándar y no con `-c`: con `-c` psql solo imprime el resultado del último
  // comando (el COMMIT), y no se vería si el UPDATE tocó la fila.
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  // El UPDATE tiene que haber tocado la remesa: sin fila, el test no mediría nada.
  if (!salida.split('\n').includes('hecho')) {
    throw new Error(`remesa-como-sus-funciones: la remesa no cambió: ${salida}`)
  }
}

function fechaValida(v: string, que: string): string {
  if (Number.isNaN(new Date(v).getTime()) || !/^[0-9T:.+\-Z ]+$/.test(v))
    throw new Error(`remesa-como-sus-funciones: ${que} no válida: ${v}`)
  return v
}

/**
 * `enviada_at` del fichero de la versión vigente, que ninguna sesión lee (la tabla no tiene
 * privilegios para nadie): en solo lectura, como `postgres`. NULL si no la tiene; `'sin_fichero'`
 * si la remesa no tiene fichero de su marca.
 */
export function enviadaAtDelFichero(remesaId: string): string | null {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: solo en la BD efímera del CI')
  if (!UUID.test(remesaId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${remesaId}`)
  const sql = [
    'BEGIN READ ONLY;',
    `SELECT coalesce((SELECT coalesce(f.enviada_at::text, 'null') FROM public.remesa_ficheros f
       JOIN public.remesas r ON r.id = f.remesa_id AND f.generado_at = r.fichero_generado_at
      WHERE r.id = '${remesaId}'), 'sin_fichero');`,
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  const v = salida.split('\n').find((l) => l.trim() !== '')
  if (v === undefined) throw new Error(`enviadaAtDelFichero: sin salida`)
  return v === 'null' ? null : v
}

/**
 * Los ficheros guardados de una remesa, con su `reabierta_at` (que ninguna sesión lee): en solo
 * lectura, como `postgres`. Uno por versión, del más antiguo al más reciente.
 */
export function ficherosDeLaRemesa(
  remesaId: string
): Array<{ msgId: string; reabierta: boolean; enviada: boolean }> {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: solo en la BD efímera del CI')
  if (!UUID.test(remesaId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${remesaId}`)
  const sql = [
    'BEGIN READ ONLY;',
    `SELECT 'f|' || msg_id || '|' || (reabierta_at IS NOT NULL) || '|' || (enviada_at IS NOT NULL)
       FROM public.remesa_ficheros WHERE remesa_id = '${remesaId}' ORDER BY generado_at;`,
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  return salida
    .split('\n')
    .filter((l) => l.startsWith('f|'))
    .map((l) => {
      const [, msgId, reabierta, enviada] = l.split('|')
      return { msgId, reabierta: reabierta === 'true', enviada: enviada === 'true' }
    })
}

/** La marca del fichero, como la pone `registrar_fichero_remesa` (sin el registro). */
export function ponerMarcaComoElRegistro(remesaId: string, marca: string): void {
  comoPostgres(
    remesaId,
    'app.registrar_fichero',
    `fichero_generado_at = '${fechaValida(marca, 'marca')}'`
  )
}

/** La remesa enviada, como la pasa `marcar_remesa_enviada` (sin tocar sus recibos). */
export function marcarEnviadaComoLaFuncion(remesaId: string, fecha: string): void {
  comoPostgres(
    remesaId,
    'app.marcar_remesa_enviada',
    `estado = 'enviada', fecha_envio_banco = '${fechaValida(fecha, 'fecha')}'`
  )
}

/**
 * Los recibos, en `enviado_banco` con su fecha, como los pasa `marcar_remesa_enviada`: uno a uno,
 * cada uno con su marcador. Sin JWT el congelado de mes cerrado actúa igual que dentro de la función
 * llamada con sesión (`auth.role()` no es service_role). Ni la remesa ni su fichero se tocan: los
 * fixtures de un recibo enviado fuera de toda remesa no los tienen.
 */
export function pasarAEnviadoComoMarcar(reciboIds: string[], fecha: string): void {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: el recibo solo se prepara así en la BD efímera del CI')
  if (reciboIds.length === 0) throw new Error('pasarAEnviadoComoMarcar: sin recibos')
  for (const id of reciboIds)
    if (!UUID.test(id)) throw new Error(`remesa-como-sus-funciones: id no válido: ${id}`)
  const dia = fechaValida(fecha, 'fecha')
  const sql = [
    'BEGIN;',
    ...reciboIds.flatMap((id) => [
      `SELECT set_config('app.marcar_recibo_enviado', '${id}', true);`,
      `UPDATE public.recibos SET estado = 'enviado_banco', fecha_envio_banco = '${dia}' WHERE id = '${id}' RETURNING 'hecho';`,
    ]),
    "SELECT set_config('app.marcar_recibo_enviado', '', true);",
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  // Cada UPDATE tiene que haber tocado su recibo: sin fila, el test no mediría nada.
  const hechos = salida.split('\n').filter((l) => l === 'hecho').length
  if (hechos !== reciboIds.length) {
    throw new Error(`pasarAEnviadoComoMarcar: ${hechos} de ${reciboIds.length} recibos: ${salida}`)
  }
}

/** Lo que el recibo lleva al llegar a su estado (las columnas que escriben sus funciones). */
export interface DestinoRecibo {
  estado: 'borrador' | 'pendiente_procesar' | 'enviado_banco' | 'devuelto' | 'cobrado_manual'
  fecha_envio_banco?: string | null
  fecha_devolucion?: string | null
  devolucion_gastos_centimos?: number | null
  devolucion_salida?: string | null
  cobro_forma?: string | null
  cobro_fecha?: string | null
  cobro_nota?: string | null
  cobro_importe_centimos?: number | null
}

const COLUMNAS_DESTINO = [
  'estado',
  'fecha_envio_banco',
  'fecha_devolucion',
  'devolucion_gastos_centimos',
  'devolucion_salida',
  'cobro_forma',
  'cobro_fecha',
  'cobro_nota',
  'cobro_importe_centimos',
] as const

/**
 * Para los fixtures que crean un recibo ya en un estado del circuito de cobro: la fila en borrador y
 * sin esas columnas, para insertarla, y el destino al que después lo lleva `prepararRecibo`. Desde
 * `20261223120000` un recibo nace en borrador (salvo el esporádico de `crear_recibo_esporadico` y el
 * re-giro de `resolver_devolucion`) y cada paso del circuito lo da su función.
 */
export function enBorrador<T extends object>(fila: T): { fila: T; destino: DestinoRecibo | null } {
  const f = fila as Record<string, unknown>
  // Sin estado, la fila nace con el DEFAULT de la columna, `borrador` desde 20261224120000 (antes
  // `pendiente_procesar`). Se pide explícito igualmente.
  const estado = (f.estado ?? 'borrador') as DestinoRecibo['estado']
  if (estado === 'borrador') return { fila: { ...f, estado: 'borrador' } as T, destino: null }
  const destino: Record<string, unknown> = {}
  const resto: Record<string, unknown> = { ...f, estado: 'borrador' }
  for (const c of COLUMNAS_DESTINO) {
    if (c in f) destino[c] = f[c]
    if (c !== 'estado') delete resto[c]
  }
  return { fila: resto as T, destino: destino as unknown as DestinoRecibo }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
  throw new Error(`prepararRecibo: valor no admitido: ${String(v)}`)
}

/**
 * Lleva un recibo de borrador a su estado como lo llevan sus funciones, paso a paso y con el
 * marcador de cada una (FICCIÓN DE LOS TESTS: solo las transiciones, sin lo demás que hacen; por
 * ejemplo, el ancla de `cierre_mensual` de `confirmar_recibo` no se pone, igual que no la ponía el
 * UPDATE directo que sustituye):
 *  - a pendiente, `confirmar_recibo` (`app.confirmar_recibo`);
 *  - a enviado, `marcar_remesa_enviada` (`app.marcar_recibo_enviado`);
 *  - a devuelto, `marcar_recibo_devuelto` (`app.marcar_recibo_devuelto`);
 *  - a cobrado: desde devuelto, `resolver_devolucion` (`app.resolver_devolucion`); con cheque,
 *    `cobrar_recibo_con_cheque` (`app.cobro_cheque`); si no, `marcar_cobrado_manual`;
 *  - la salida de una devolución que se queda en devuelto, `resolver_devolucion`.
 * Va como `postgres` con el claim de service_role, como iban los fixtures con `serviceClient`: el
 * congelado le exime igual que antes.
 */
export function prepararRecibo(reciboId: string, d: DestinoRecibo): void {
  prepararRecibos([[reciboId, d]])
}

/** Los pasos de `prepararRecibo` para un recibo: [marcador, SET] en orden. */
function pasosHasta(d: DestinoRecibo): Array<[string, string]> {
  const pasos: Array<[string, string]> = []
  const conDevolucion =
    d.estado === 'devuelto' || (d.estado === 'cobrado_manual' && d.fecha_devolucion)
  const conEnvio = d.estado === 'enviado_banco' || conDevolucion
  if (d.estado !== 'borrador') pasos.push(['app.confirmar_recibo', "estado = 'pendiente_procesar'"])
  if (conEnvio) {
    pasos.push([
      'app.marcar_recibo_enviado',
      `estado = 'enviado_banco', fecha_envio_banco = ${literal(d.fecha_envio_banco)}`,
    ])
  }
  if (conDevolucion) {
    pasos.push([
      'app.marcar_recibo_devuelto',
      `estado = 'devuelto', fecha_devolucion = ${literal(d.fecha_devolucion)}, devolucion_gastos_centimos = ${literal(d.devolucion_gastos_centimos ?? 0)}`,
    ])
  }
  if (d.estado === 'cobrado_manual') {
    const marcador = conDevolucion
      ? 'app.resolver_devolucion'
      : d.cobro_forma === 'cheque_guarderia'
        ? 'app.cobro_cheque'
        : 'app.marcar_cobrado_manual'
    pasos.push([
      marcador,
      [
        "estado = 'cobrado_manual'",
        `cobro_forma = ${literal(d.cobro_forma)}`,
        `cobro_fecha = ${literal(d.cobro_fecha)}`,
        `cobro_nota = ${literal(d.cobro_nota)}`,
        `cobro_importe_centimos = ${literal(d.cobro_importe_centimos)}`,
        ...(conDevolucion ? [`devolucion_salida = ${literal(d.devolucion_salida)}`] : []),
      ].join(', '),
    ])
  } else if (d.estado === 'devuelto' && d.devolucion_salida) {
    pasos.push(['app.resolver_devolucion', `devolucion_salida = ${literal(d.devolucion_salida)}`])
  }
  return pasos
}

/** `prepararRecibo` de varios recibos en una sola transacción (y un solo psql). */
export function prepararRecibos(lista: Array<[string, DestinoRecibo]>): void {
  if (lista.length === 0) return
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: el recibo solo se prepara así en la BD efímera del CI')
  const lineas: string[] = []
  let esperados = 0
  for (const [reciboId, d] of lista) {
    if (!UUID.test(reciboId))
      throw new Error(`remesa-como-sus-funciones: id no válido: ${reciboId}`)
    for (const [marcador, set] of pasosHasta(d)) {
      esperados++
      lineas.push(
        `SELECT set_config('${marcador}', '${reciboId}', true);`,
        `UPDATE public.recibos SET ${set} WHERE id = '${reciboId}' RETURNING 'hecho';`,
        `SELECT set_config('${marcador}', '', true);`
      )
    }
  }
  if (esperados === 0) return
  const sql = [
    'BEGIN;',
    `SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);`,
    ...lineas,
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  // Cada paso tiene que haber tocado su recibo: sin fila, el test no mediría nada.
  const hechos = salida.split('\n').filter((l) => l === 'hecho').length
  if (hechos !== esperados) {
    throw new Error(`prepararRecibos: ${hechos} de ${esperados} pasos: ${salida}`)
  }
}

/**
 * Inserta recibos como lo haría un fixture con `serviceClient`, pero por el único camino que queda:
 * en borrador (`enBorrador`), y después cada uno a su estado con `prepararRecibos`. Devuelve los ids
 * en el orden de las filas (los de RETURNING).
 */
export async function insertarRecibos<T extends object>(filas: T[]): Promise<string[]> {
  const partes = filas.map((f) => enBorrador(f))
  const { data, error } = await serviceClient
    .from('recibos')
    .insert(partes.map((p) => p.fila) as never)
    .select('id')
  if (error || !data || data.length !== filas.length)
    throw new Error(`insertarRecibos: ${error?.message ?? `${data?.length} de ${filas.length}`}`)
  const ids = data.map((r) => r.id)
  prepararRecibos(
    partes.flatMap(
      (p, i): Array<[string, DestinoRecibo]> => (p.destino ? [[ids[i], p.destino]] : [])
    )
  )
  return ids
}

/** Lo que responde la base a un intento: pasa con N filas, o el error con su código y su HINT. */
export type Intento =
  | { pasa: true; filas: number }
  | { pasa: false; code: string; hint: string; message: string }

/**
 * El caso que SEPARA dos defensas solapadas: un UPDATE del recibo con el marcador de su función
 * puesto, para que `recibos_dinero_solo_por_funcion` lo deje pasar, y ver que la defensa de detrás
 * sigue respondiendo (FICCIÓN DE LOS TESTS: es lo que pasaría si la función se equivocara un día).
 * Como `postgres` por psql, con el claim que se pida (`service_role`, o `authenticated` para que el
 * congelado actúe como con sesión), y SIEMPRE se deshace, pase o no: no deja nada escrito.
 */
export function intentarConMarcador(
  reciboId: string,
  marcador: string,
  set: string,
  rol: 'service_role' | 'authenticated' = 'service_role'
): Intento {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: el intento solo se hace así en la BD efímera del CI')
  if (!UUID.test(reciboId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${reciboId}`)
  if (!/^app\.[a-z_]+$/.test(marcador))
    throw new Error(`intentarConMarcador: marcador: ${marcador}`)
  const sql = [
    'BEGIN;',
    `SELECT set_config('request.jwt.claims', '{"role":"${rol}"}', true);`,
    `CREATE FUNCTION pg_temp.intento() RETURNS text LANGUAGE plpgsql AS $i$
     DECLARE n int; st text; h text; m text;
     BEGIN
       PERFORM set_config('${marcador}', '${reciboId}', true);
       UPDATE public.recibos SET ${set} WHERE id = '${reciboId}';
       GET DIAGNOSTICS n = ROW_COUNT;
       RETURN 'pasa|' || n;
     EXCEPTION WHEN OTHERS THEN
       GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, h = PG_EXCEPTION_HINT, m = MESSAGE_TEXT;
       RETURN 'error|' || st || '|' || coalesce(h, '') || '|' || replace(m, E'\\n', ' ');
     END $i$;`,
    'SELECT pg_temp.intento();',
    'ROLLBACK;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  const linea = salida.split('\n').find((l) => l.startsWith('pasa|') || l.startsWith('error|'))
  if (linea === undefined) throw new Error(`intentarConMarcador: sin respuesta: ${salida}`)
  const [que, a, b, ...resto] = linea.split('|')
  if (que === 'pasa') return { pasa: true, filas: Number(a) }
  return { pasa: false, code: a, hint: b, message: resto.join('|') }
}

/** Quién lanza un rechazo: su código, su HINT y la primera línea del contexto del error. */
export interface Rechazo {
  code: string
  hint: string
  /** «PL/pgSQL function <nombre>(…) line N at RAISE»: la función o el trigger que lo lanzó. */
  origen: string
}

/**
 * El caso que separa dos defensas que dicen LO MISMO (mismo código, mismo HINT y mismo mensaje):
 * lo único que las distingue es QUIÉN lanza el RAISE, y eso solo está en el contexto del error, que
 * PostgREST no devuelve. Llama `p_sql` como la sesión de `usuarioId` (claim `authenticated` y rol
 * `authenticated`, como por PostgREST), por psql, y SIEMPRE se deshace. Si la llamada pasa, null.
 */
export function quienRechaza(usuarioId: string, p_sql: string): Rechazo | null {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: solo en la BD efímera del CI')
  if (!UUID.test(usuarioId)) throw new Error(`quienRechaza: id no válido: ${usuarioId}`)
  const sql = [
    'BEGIN;',
    `CREATE FUNCTION pg_temp.quien() RETURNS text LANGUAGE plpgsql AS $q$
     DECLARE st text; h text; c text;
     BEGIN
       PERFORM set_config('request.jwt.claims', '{"sub":"${usuarioId}","role":"authenticated"}', true);
       EXECUTE 'SET LOCAL ROLE authenticated';
       EXECUTE $s$${p_sql}$s$;
       RETURN 'pasa';
     EXCEPTION WHEN OTHERS THEN
       GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, h = PG_EXCEPTION_HINT, c = PG_EXCEPTION_CONTEXT;
       RETURN 'error|' || st || '|' || coalesce(h, '') || '|' || split_part(c, E'\\n', 1);
     END $q$;`,
    'SELECT pg_temp.quien();',
    'ROLLBACK;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  const linea = salida.split('\n').find((l) => l === 'pasa' || l.startsWith('error|'))
  if (linea === undefined) throw new Error(`quienRechaza: sin respuesta: ${salida}`)
  if (linea === 'pasa') return null
  const [, code, hint, ...origen] = linea.split('|')
  return { code, hint, origen: origen.join('|') }
}
