/** Lo que devuelve `poner_retencion` (20261206120000). */
export interface ResultadoPoner {
  /** Cuántas retenciones se han puesto: los que ya estaban retenidos no cuentan. */
  puestas: number
  /** Las peticiones de olvido confirmadas que la retención ha devuelto a pendiente. */
  deshechas: string[]
}

/** `null` si la respuesta no tiene la forma esperada: no se adivina qué se ha hecho. */
export function leerResultadoPoner(data: unknown): ResultadoPoner | null {
  if (typeof data !== 'object' || data === null) return null
  const { puestas, deshechas } = data as Record<string, unknown>
  if (typeof puestas !== 'number' || !Array.isArray(deshechas)) return null
  if (!deshechas.every((d): d is string => typeof d === 'string')) return null
  return { puestas, deshechas }
}
