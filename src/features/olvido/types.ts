import type { Database } from '@/types/database'

// --- Result pattern (idéntico al resto de features) -------------------------
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Tipos de dominio -------------------------------------------------------
export type SujetoOlvido = Database['public']['Enums']['olvido_sujeto_tipo']
export type OlvidoSolicitudRow = Database['public']['Tables']['olvido_solicitudes']['Row']

/** Marcador de PII usado en toda la pieza (coincide con el de la migración). */
export const MARCADOR_PII = '[borrado]'
