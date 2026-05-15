import type { MotivoAusencia } from './schemas/ausencia'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

export interface AusenciaRow {
  id: string
  nino_id: string
  fecha_inicio: string
  fecha_fin: string
  motivo: MotivoAusencia
  descripcion: string | null
  reportada_por: string | null
  created_at: string
  updated_at: string
}
