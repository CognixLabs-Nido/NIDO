// Concepto de cada adeudo del fichero SEPA (`RmtInf/Ustrd`), lo que la familia lee en el
// extracto del banco. Decisión del responsable (D9 y PR-0b de `docs/specs/altas-serie.md`):
// «ANAIA · Lucia Garcia Lopez · Octubre 2026» — centro, niño y mes, sin tildes. Antes era el
// UUID del recibo, que a la familia no le dice nada.
//
// El recibo es de la FAMILIA (F-4-1: `recibos.nino_id` va a NULL); el niño sale de sus líneas.
// Un recibo con varios hermanos lleva todos los nombres; uno sin ninguna línea con niño, solo
// centro y mes.
//
// El `·` se queda aquí a propósito: es el formato que decidió el responsable, y si algún día se
// enseña el concepto en una pantalla, va así. En el fichero pasa a guion (`textoSepa`), porque el
// punto medio no está en el juego de caracteres de SEPA. No igualarlos: son dos sitios con dos
// reglas.
//
// CABER EN 140 (Max140), decidido a propósito, no por recorte (PR-0b, 2026-10-31). Se acorta por
// este orden de importancia: el NIÑO es lo que dice de quién es el cobro, el MES no se toca nunca,
// y el CENTRO es lo primero que cede, porque el extracto ya enseña al acreedor por su nombre
// (`Cdtr/Nm`). Se prueba cada forma en este orden y se queda la primera que cabe:
//   1. nombre y apellidos de todos los niños;
//   2. si todos comparten apellidos, los nombres y los apellidos una vez («Ana y Pablo Garcia»);
//   3. solo los nombres;
// cada una con el centro entero y, si no cabe, con el centro acortado a 30 caracteres por
// palabras. Si ninguna cabe: el centro acortado, los nombres que quepan y «y N más».
// Nunca se corta a mitad de una palabra (salvo una sola palabra más larga que todo el hueco).

import { MAX_CONCEPTO_SEPA } from './generar-pain008'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

/** Largo al que se acorta el nombre del centro cuando no cabe entero. */
export const MAX_CENTRO_ACORTADO = 30

const SEP = ' · '

/** Quita tildes y diéresis (y la virgulilla de la ñ): «Lucía Peña» → «Lucia Pena». */
export function sinTildes(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function limpio(value: string | null | undefined): string {
  return sinTildes(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Las palabras que quepan en `max`; una sola palabra más larga se corta (no hay otra). */
function acortarPorPalabras(texto: string, max: number): string {
  if (texto.length <= max) return texto
  let out = ''
  for (const palabra of texto.split(' ')) {
    const siguiente = out ? `${out} ${palabra}` : palabra
    if (siguiente.length > max) break
    out = siguiente
  }
  return out || texto.slice(0, max)
}

/** «A», «A y B», «A, B y C». */
function enumerar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join('')
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

export interface NinoDelConcepto {
  nombre: string
  apellidos: string | null
}

export interface DatosConcepto {
  centro: string
  /** Los niños del recibo, en cualquier orden y sin repetir. */
  ninos: NinoDelConcepto[]
  anio: number
  /** 1..12 */
  mes: number
}

/** Las formas de escribir a los niños, de la más completa a la más corta (pasos 1 a 3). */
function formasDeLosNinos(ninos: { nombre: string; apellidos: string }[]): string[] {
  if (ninos.length === 0) return ['']
  const completos = ninos.map((n) => [n.nombre, n.apellidos].filter(Boolean).join(' '))
  const formas = [enumerar(completos)]
  const apellidos = ninos[0].apellidos
  if (ninos.length > 1 && apellidos && ninos.every((n) => n.apellidos === apellidos)) {
    formas.push(`${enumerar(ninos.map((n) => n.nombre))} ${apellidos}`)
  }
  formas.push(enumerar(ninos.map((n) => n.nombre)))
  return formas
}

function componer(centro: string, ninos: string, mes: string): string {
  return [centro, ninos, mes].filter(Boolean).join(SEP)
}

export function conceptoAdeudo(d: DatosConcepto): string {
  const ninos = d.ninos
    .map((n) => ({ nombre: limpio(n.nombre), apellidos: limpio(n.apellidos) }))
    .filter((n) => n.nombre)
    .sort((a, b) => `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`, 'es'))
  const mes = `${MESES[d.mes - 1]} ${d.anio}`
  const centro = limpio(d.centro)
  const centroCorto = acortarPorPalabras(centro, MAX_CENTRO_ACORTADO)

  for (const forma of formasDeLosNinos(ninos)) {
    for (const c of [centro, centroCorto]) {
      const concepto = componer(c, forma, mes)
      if (concepto.length <= MAX_CONCEPTO_SEPA) return concepto
    }
  }

  // Ninguna forma cabe: los nombres que quepan y «y N más».
  const nombres = ninos.map((n) => n.nombre)
  for (let k = nombres.length - 1; k >= 1; k--) {
    const concepto = componer(
      centroCorto,
      `${nombres.slice(0, k).join(', ')} y ${nombres.length - k} más`,
      mes
    )
    if (concepto.length <= MAX_CONCEPTO_SEPA) return concepto
  }
  // Un solo niño con un nombre imposible: su nombre, por palabras, en el hueco que quede.
  const hueco = MAX_CONCEPTO_SEPA - componer(centroCorto, '', mes).length - SEP.length
  return componer(centroCorto, acortarPorPalabras(nombres[0] ?? '', hueco), mes)
}

export interface ReciboConcepto {
  id: string
  anio: number
  mes: number
}

export interface LineaConcepto {
  recibo_id: string
  nino_id: string | null
}

export interface NinoConcepto {
  id: string
  nombre: string
  apellidos: string | null
}

/**
 * Concepto de cada recibo de la remesa, por id. Cada recibo pedido sale en el mapa: el que no
 * tiene líneas con niño lleva centro y mes. Un niño de una línea que no llega en `ninos` (la
 * lectura no lo devolvió) se omite del nombre, no tumba el fichero.
 */
export function conceptosDeRemesa(
  centro: string,
  recibos: ReciboConcepto[],
  lineas: LineaConcepto[],
  ninos: NinoConcepto[]
): Map<string, string> {
  const ninoPorId = new Map(ninos.map((n) => [n.id, n]))
  const ninosDe = new Map<string, Map<string, NinoDelConcepto>>()
  for (const l of lineas) {
    if (!l.nino_id) continue
    const nino = ninoPorId.get(l.nino_id)
    if (!nino) continue
    const delRecibo = ninosDe.get(l.recibo_id) ?? new Map<string, NinoDelConcepto>()
    delRecibo.set(nino.id, { nombre: nino.nombre, apellidos: nino.apellidos })
    ninosDe.set(l.recibo_id, delRecibo)
  }
  return new Map(
    recibos.map((r) => [
      r.id,
      conceptoAdeudo({
        centro,
        ninos: [...(ninosDe.get(r.id)?.values() ?? [])],
        anio: r.anio,
        mes: r.mes,
      }),
    ])
  )
}
