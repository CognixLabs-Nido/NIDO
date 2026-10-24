// Lógica PURA de beca comedor v2 (V2-3, PR-10): meses del curso, agrupación de tramos en
// "cargas", relleno con la carga anterior, plan de cambios al guardar y chequeo de mes
// cerrado. Sin dependencias de red ni Supabase → unit-testable.
//
// Una CARGA no existe como fila propia en el modelo: se identifica por (curso, año/mes
// CORRESPONDIENTE) gracias al índice parcial UNIQUE `beca_tramo_normal_unico`
// (nino_id, anio_correspondiente, mes_correspondiente WHERE origen='normal') → un tramo
// normal por niño y mes correspondiente. Desde el PR-10 cada tramo lleva el importe de SU
// alumno (varía con los ingresos de la familia); el mes de aplicación sigue siendo el de toda
// la carga.
export interface MesCurso {
  anio: number
  mes: number
}

/**
 * Lista de (año, mes) que cubre el curso, de `fecha_inicio` a `fecha_fin` inclusive.
 * Las fechas llegan como 'YYYY-MM-DD' (se leen los 7 primeros chars, sin `Date`, para no
 * depender del huso). Devuelve en orden cronológico ascendente.
 */
export function mesesDelCurso(fechaInicio: string, fechaFin: string): MesCurso[] {
  let anio = Number(fechaInicio.slice(0, 4))
  let mes = Number(fechaInicio.slice(5, 7))
  const anioFin = Number(fechaFin.slice(0, 4))
  const mesFin = Number(fechaFin.slice(5, 7))
  const out: MesCurso[] = []
  // Guarda de seguridad (máx 24 meses) por si las fechas vienen invertidas o corruptas.
  while ((anio < anioFin || (anio === anioFin && mes <= mesFin)) && out.length < 24) {
    out.push({ anio, mes })
    mes++
    if (mes > 12) {
      mes = 1
      anio++
    }
  }
  return out
}

export interface TramoParaCarga {
  nino_id: string
  anio_correspondiente: number
  mes_correspondiente: number
  anio_aplicacion: number
  mes_aplicacion: number
  importe_centimos: number
  /** PR-5: `aplicada` = descontada en un recibo validado. */
  estado: 'pendiente' | 'aplicada' | 'anulada'
}

export interface ImporteAlumno {
  centimos: number
  /** El tramo ya está descontado en un recibo validado: no se toca. */
  aplicado: boolean
}

export interface CargaAgrupada {
  anioCorrespondiente: number
  mesCorrespondiente: number
  anioAplicacion: number
  mesAplicacion: number
  /** PR-10: el importe de cada alumno de la carga, por `nino_id`. */
  importes: Record<string, ImporteAlumno>
  /** Importes distintos de la carga, de menor a mayor (para el resumen de la lista). */
  importesDistintos: number[]
  nBecados: number
  /** PR-5: cuántos de esos tramos ya están descontados en un recibo validado. */
  nAplicados: number
}

/**
 * Agrupa tramos (se asume ya filtrados a `origen='normal'` y un solo curso) en cargas, una por
 * (año/mes correspondiente). El mes de aplicación es el de la carga (todos sus tramos lo
 * comparten); el importe es el de cada alumno. Orden: por mes correspondiente.
 */
export function agruparCargas(tramos: TramoParaCarga[]): CargaAgrupada[] {
  const map = new Map<string, CargaAgrupada>()
  for (const t of tramos) {
    const k = mesKeyNum(t.anio_correspondiente, t.mes_correspondiente)
    let cur = map.get(k)
    if (!cur) {
      cur = {
        anioCorrespondiente: t.anio_correspondiente,
        mesCorrespondiente: t.mes_correspondiente,
        anioAplicacion: t.anio_aplicacion,
        mesAplicacion: t.mes_aplicacion,
        importes: {},
        importesDistintos: [],
        nBecados: 0,
        nAplicados: 0,
      }
      map.set(k, cur)
    }
    const aplicado = t.estado === 'aplicada'
    cur.importes[t.nino_id] = { centimos: t.importe_centimos, aplicado }
    cur.nBecados++
    if (aplicado) cur.nAplicados++
  }
  for (const c of map.values()) {
    c.importesDistintos = [...new Set(Object.values(c.importes).map((i) => i.centimos))].sort(
      (a, b) => a - b
    )
  }
  return [...map.values()].sort(
    (a, b) =>
      a.anioCorrespondiente - b.anioCorrespondiente || a.mesCorrespondiente - b.mesCorrespondiente
  )
}

function mesKeyNum(anio: number, mes: number): string {
  return `${anio}-${mes}`
}

/**
 * PR-10 — la carga nueva viene rellena con los importes de la carga ANTERIOR: la del mes
 * correspondiente más reciente antes del elegido (no suele variar; se toca solo lo que
 * cambie). Devuelve esa carga, o `null` si no hay ninguna antes.
 */
export function cargaAnterior(
  cargas: CargaAgrupada[],
  anio: number,
  mes: number
): CargaAgrupada | null {
  let mejor: CargaAgrupada | null = null
  for (const c of cargas) {
    const antes =
      c.anioCorrespondiente < anio || (c.anioCorrespondiente === anio && c.mesCorrespondiente <= mes)
    if (!antes) continue
    if (
      !mejor ||
      c.anioCorrespondiente > mejor.anioCorrespondiente ||
      (c.anioCorrespondiente === mejor.anioCorrespondiente &&
        c.mesCorrespondiente > mejor.mesCorrespondiente)
    ) {
      mejor = c
    }
  }
  return mejor
}

/** Los becados (elegibilidad activa) que no tienen importe en la carga. */
export function becadosSinImporte(carga: CargaAgrupada, becados: string[]): string[] {
  return becados.filter((id) => carga.importes[id] == null)
}

export interface TramoExistente {
  id: string
  nino_id: string
  importe_centimos: number
  estado: 'pendiente' | 'aplicada' | 'anulada'
}

export interface FilaCarga {
  nino_id: string
  /** `null` = sin beca ese mes. */
  importe_centimos: number | null
}

export type PlanCarga =
  | {
      ok: true
      insertar: Array<{ nino_id: string; importe_centimos: number }>
      /** Por importe nuevo, los tramos que pasan a él. */
      actualizar: Array<{ importe_centimos: number; ids: string[] }>
      borrar: string[]
      /** Tramos pendientes que siguen en la carga (los que se mueven si cambia el mes). */
      mover: string[]
    }
  | { ok: false; error: 'carga_aplicada' }

/**
 * PR-10 — qué hay que escribir para que la carga quede como `filas`, partiendo de sus tramos
 * `existentes`. Es idempotente: con la carga ya guardada, el plan sale vacío (un reintento tras
 * un fallo a medias termina el trabajo).
 *  - un alumno sin tramo y con importe → tramo nuevo (el becado que llegó después de la carga);
 *  - un tramo pendiente → cambia de importe, o se borra si la fila viene sin importe;
 *  - un tramo ya descontado (aplicado) no se toca: si la fila le cambia el importe o se lo quita,
 *    error; y con alguno aplicado, la carga no cambia de mes de aplicación;
 *  - un tramo cuyo alumno no viene en `filas` se queda como está.
 */
export function planGuardarCarga(
  existentes: TramoExistente[],
  filas: FilaCarga[],
  cambiaAplicacion: boolean
): PlanCarga {
  const porNino = new Map(existentes.map((t) => [t.nino_id, t]))
  if (cambiaAplicacion && existentes.some((t) => t.estado === 'aplicada')) {
    return { ok: false, error: 'carga_aplicada' }
  }
  const insertar: Array<{ nino_id: string; importe_centimos: number }> = []
  const actualizar = new Map<number, string[]>()
  const borrar: string[] = []
  for (const f of filas) {
    const t = porNino.get(f.nino_id)
    if (!t) {
      if (f.importe_centimos != null) {
        insertar.push({ nino_id: f.nino_id, importe_centimos: f.importe_centimos })
      }
      continue
    }
    if (t.estado === 'aplicada') {
      if (f.importe_centimos !== t.importe_centimos) return { ok: false, error: 'carga_aplicada' }
      continue
    }
    if (f.importe_centimos == null) {
      borrar.push(t.id)
    } else if (f.importe_centimos !== t.importe_centimos) {
      actualizar.set(f.importe_centimos, [...(actualizar.get(f.importe_centimos) ?? []), t.id])
    }
  }
  const borrados = new Set(borrar)
  const mover = cambiaAplicacion
    ? existentes.filter((t) => t.estado !== 'aplicada' && !borrados.has(t.id)).map((t) => t.id)
    : []
  return {
    ok: true,
    insertar,
    actualizar: [...actualizar].map(([importe_centimos, ids]) => ({ importe_centimos, ids })),
    borrar,
    mover,
  }
}

/** ¿El mes (año, mes) está CERRADO? (existe fila en `cierre_mensual` → recibos congelados). */
export function mesCerrado(cierres: MesCurso[], anio: number, mes: number): boolean {
  return cierres.some((c) => c.anio === anio && c.mes === mes)
}
