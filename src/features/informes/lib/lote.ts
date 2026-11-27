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
  /** No publicados porque les faltan ítems por valorar. Quedan en borrador. */
  incompletos: number
  /**
   * No publicados por cualquier otro motivo (permiso, informe no encontrado, la escritura falló). Censo C
   * (publicar-lote-informes:111, 2026-11-26): antes contaban como «incompletos (faltan ítems)», un motivo falso
   * que mandaba a buscar ítems sin valorar que no faltaban.
   */
  fallidos: number
}

/** El único `fail` de `publicarInforme` que es «incompleto». */
const FALTAN_VALORACIONES = 'informes.errors.faltan_valoraciones'

/**
 * Agrega los resultados de intentar publicar cada borrador del lote. Best-effort:
 * los `success` cuentan como publicados; el resto (incompletos) se quedan en
 * borrador. Nunca lanza — un fallo individual no aborta el lote.
 */
export function resumenLote(resultados: ActionResult<unknown>[]): ResumenLote {
  const publicados = resultados.filter((r) => r.success).length
  const incompletos = resultados.filter((r) => !r.success && r.error === FALTAN_VALORACIONES).length
  return {
    total: resultados.length,
    publicados,
    incompletos,
    fallidos: resultados.length - publicados - incompletos,
  }
}
