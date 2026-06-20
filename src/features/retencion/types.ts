import type { Database } from '@/types/database'

// --- Result pattern (idéntico al resto de features) -------------------------
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Tipos de dominio (espejo de la migración A6) ---------------------------
export type RetencionCategoria = Database['public']['Enums']['retencion_categoria']
export type RetencionAccion = Database['public']['Enums']['retencion_accion']
export type RetencionEjecucionRow = Database['public']['Tables']['retencion_ejecuciones']['Row']

// -----------------------------------------------------------------------------
// PLAZOS DE RETENCIÓN — placeholders configurables.
// PENDIENTE política de retención del abogado (F11-B): estos valores son
// marcadores de prueba (decisión #12), igual que los textos legales. No hay datos
// reales en producción hasta cerrar F11.
// -----------------------------------------------------------------------------

/** Recogida PUNTUAL (válida solo el día): purga el DNI a los N días de caducar. */
export const RETENCION_RECOGIDA_PUNTUAL_DIAS = 7 // PENDIENTE política F11-B

/** Recogida HABITUAL (vigencia abierta): purga el DNI a los N meses de la baja. */
export const RETENCION_RECOGIDA_HABITUAL_MESES = 12 // PENDIENTE política F11-B

/** Fotos de menores (ficha + blog): purga a los N meses tras la baja de matrícula. */
export const RETENCION_FOTOS_MESES = 12 // PENDIENTE política F11-B

/**
 * Esqueleto huérfano (alta abandonada): purga el niño/matrícula/invitación a los N
 * días de CADUCAR la invitación (`expires_at`). Se mide desde `expires_at` porque
 * re-invitar lo resetea: una invitación aún vencida prueba que nadie la reactivó.
 */
export const GRACIA_ESQUELETO_DIAS = 30 // configurable; PENDIENTE política F11-B

/** Una unidad de purga: 1+ objetos de Storage del mismo sujeto/categoría. */
export interface UnidadRetencion {
  categoria: RetencionCategoria
  centroId: string
  /** Tipo de referencia para la traza (sin PII). */
  refTipo: 'nino' | 'firma' | 'usuario'
  refId: string
  bucket: string
  /** Rutas de Storage a borrar (solo en purga real, no en dry-run). */
  paths: string[]
  /** Predicado que disparó la retención (traza). */
  motivo: string
}

export interface ResultadoBarrido {
  dryRun: boolean
  /** Unidades candidatas encontradas. */
  total: number
  /** Objetos de Storage purgados (0 en dry-run). */
  objetosPurgados: number
  /** Unidades que fallaron (se reintentan en la siguiente pasada). */
  fallidos: number
  porCategoria: Record<string, number>
}
