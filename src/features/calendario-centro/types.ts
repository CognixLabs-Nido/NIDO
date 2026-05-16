import type { Database } from '@/types/database'

import type { TipoDiaCentro } from './schemas/dia-centro'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** Fila persistida en `dias_centro`. */
export type DiaCentroRow = Database['public']['Tables']['dias_centro']['Row']

/** Override resuelto para la query del calendario mensual. */
export interface OverrideMes {
  /** YYYY-MM-DD */
  fecha: string
  tipo: TipoDiaCentro
  observaciones: string | null
}

/** Día cerrado próximo (para el widget compacto). */
export interface DiaCerradoProximo {
  fecha: string
  tipo: TipoDiaCentro
  observaciones: string | null
}
