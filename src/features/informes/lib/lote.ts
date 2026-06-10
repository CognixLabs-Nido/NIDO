import type { ActionResult } from '../types'

/**
 * Sella la **primera** notificación de un informe: conserva la previa si la había
 * o estampa `ahora` si era la primera publicación (Q8: republicar no re-avisa).
 * Función pura compartida por `publicarInforme` (F9-2) y el lote (F9-5-3) para que
 * el "avisar una sola vez" sea idéntico y testeable.
 */
export function sellarNotificado(previo: string | null, ahora: string): string {
  return previo ?? ahora
}

/** Resumen del resultado de publicar en lote (best-effort, Q8). */
export interface ResumenLote {
  /** Borradores procesados (candidatos a publicar). */
  total: number
  /** Publicados con éxito (estaban completos). */
  publicados: number
  /** No publicados (incompletos: faltan ítems por valorar). Quedan en borrador. */
  incompletos: number
}

/**
 * Agrega los resultados de intentar publicar cada borrador del lote. Best-effort:
 * los `success` cuentan como publicados; el resto (incompletos) se quedan en
 * borrador. Nunca lanza — un fallo individual no aborta el lote.
 */
export function resumenLote(resultados: ActionResult<unknown>[]): ResumenLote {
  const publicados = resultados.filter((r) => r.success).length
  return {
    total: resultados.length,
    publicados,
    incompletos: resultados.length - publicados,
  }
}
