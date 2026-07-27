// Lógica PURA de beca comedor v2 (V2-3): meses del curso, agrupación de tramos en
// "cargas" y chequeo de mes cerrado. Sin dependencias de red ni Supabase → unit-testable.
//
// Una CARGA no existe como fila propia en el modelo: se identifica por (curso, año/mes
// CORRESPONDIENTE) gracias al índice parcial UNIQUE `beca_tramo_normal_unico`
// (nino_id, anio_correspondiente, mes_correspondiente WHERE origen='normal') → un tramo
// normal por niño y mes correspondiente. `mes_aplicacion` e `importe` son atributos
// uniformes del grupo (todos los becados cobran lo mismo ese mes).

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
  anio_correspondiente: number
  mes_correspondiente: number
  anio_aplicacion: number
  mes_aplicacion: number
  importe_centimos: number
}

export interface CargaAgrupada {
  anioCorrespondiente: number
  mesCorrespondiente: number
  anioAplicacion: number
  mesAplicacion: number
  importeCentimos: number
  nBecados: number
}

/**
 * Agrupa tramos (se asume ya filtrados a `origen='normal'` y un solo curso) en cargas,
 * por (año/mes correspondiente, año/mes aplicación, importe). El UNIQUE garantiza que
 * todos los tramos de un mismo (año/mes correspondiente) comparten aplicación e importe,
 * así que en la práctica hay una carga por mes correspondiente. Orden: por mes corr.
 */
export function agruparCargas(tramos: TramoParaCarga[]): CargaAgrupada[] {
  const map = new Map<string, CargaAgrupada>()
  for (const t of tramos) {
    const k = [
      t.anio_correspondiente,
      t.mes_correspondiente,
      t.anio_aplicacion,
      t.mes_aplicacion,
      t.importe_centimos,
    ].join(':')
    const cur = map.get(k)
    if (cur) {
      cur.nBecados++
    } else {
      map.set(k, {
        anioCorrespondiente: t.anio_correspondiente,
        mesCorrespondiente: t.mes_correspondiente,
        anioAplicacion: t.anio_aplicacion,
        mesAplicacion: t.mes_aplicacion,
        importeCentimos: t.importe_centimos,
        nBecados: 1,
      })
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.anioCorrespondiente - b.anioCorrespondiente || a.mesCorrespondiente - b.mesCorrespondiente
  )
}

/** ¿El mes (año, mes) está CERRADO? (existe fila en `cierre_mensual` → recibos congelados). */
export function mesCerrado(cierres: MesCurso[], anio: number, mes: number): boolean {
  return cierres.some((c) => c.anio === anio && c.mes === mes)
}
