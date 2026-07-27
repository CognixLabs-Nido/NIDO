// V2-4 — Reparto del EXCESO de un desborde de beca comedor entre los hijos de la familia,
// para materializar la vía DIFERIR como tramos `origen='resto'` (uno por hijo) aplicados en
// el mes siguiente. Puro y sin dependencias (testeable). Céntimos enteros en todo.
//
// El desborde se registra a nivel FAMILIA (un solo `exceso`), pero un tramo necesita un
// niño concreto. Repartimos el exceso PROPORCIONALMENTE a la beca de cada hijo ese mes por
// el MÉTODO DEL RESTO MAYOR (Hamilton): reparto entero que suma EXACTAMENTE el exceso, sin
// descuadre por redondeo. Determinista (desempate por ninoId asc).

/** Beca aplicada a un hijo en el mes del desborde (céntimos > 0 para participar). */
export interface BecaNino {
  ninoId: string
  becaCentimos: number
}

/** Parte del exceso que se difiere para un hijo (céntimos > 0). */
export interface RestoNino {
  ninoId: string
  restoCentimos: number
}

/**
 * Reparte `excesoCentimos` entre los hijos proporcionalmente a `becas`, en céntimos enteros
 * que suman EXACTAMENTE el exceso (método del resto mayor). Los hijos con beca 0 no reciben
 * nada; se omiten del resultado los que quedan a 0.
 *
 * Invariante garantizada: `Σ restoCentimos === excesoCentimos` (si hay beca total > 0 y
 * exceso > 0). Nunca produce descuadre.
 */
export function repartirExceso(excesoCentimos: number, becas: BecaNino[]): RestoNino[] {
  const participan = becas.filter((b) => b.becaCentimos > 0)
  const total = participan.reduce((acc, b) => acc + b.becaCentimos, 0)
  if (excesoCentimos <= 0 || total <= 0) return []

  // Cuota base = parte entera del reparto proporcional; `resto` = parte fraccionaria.
  const cuotas = participan.map((b) => {
    const exacto = (excesoCentimos * b.becaCentimos) / total
    const base = Math.floor(exacto)
    return { ninoId: b.ninoId, centimos: base, fraccion: exacto - base }
  })

  // Sobrante = céntimos sin asignar por el floor (0..participan.length-1). Se reparten +1 a
  // los de mayor fracción; desempate por ninoId asc (determinista).
  const asignado = cuotas.reduce((acc, c) => acc + c.centimos, 0)
  let sobrante = excesoCentimos - asignado
  const orden = [...cuotas].sort(
    (a, b) => b.fraccion - a.fraccion || a.ninoId.localeCompare(b.ninoId)
  )
  for (let i = 0; i < orden.length && sobrante > 0; i++) {
    orden[i]!.centimos += 1
    sobrante -= 1
  }

  return cuotas
    .map((c) => ({ ninoId: c.ninoId, restoCentimos: c.centimos }))
    .filter((r) => r.restoCentimos > 0)
}

/** El mes calendario siguiente a (anio, mes). Cruza el cambio de año. */
export function mesSiguiente(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 }
}
