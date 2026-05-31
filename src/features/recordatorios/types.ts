import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types ---------------------------------------------------
export type RecordatorioRow = Database['public']['Tables']['recordatorios']['Row']
export type RecordatorioInsert = Database['public']['Tables']['recordatorios']['Insert']
export type RecordatorioDestinatario = Database['public']['Enums']['recordatorio_destinatario']

// --- View models para la UI (F6-B los consume) ----------------------------

/** Item de la lista "Mis pendientes" / histórico de completados. Enriquecido
 *  con el nombre del niño (si aplica) y del autor para el render. */
export interface RecordatorioListItem {
  id: string
  destinatario: RecordatorioDestinatario
  nino_id: string | null
  nino_nombre: string | null
  titulo: string
  descripcion: string | null
  vencimiento: string | null
  completado_en: string | null
  completado_por: string | null
  erroneo: boolean
  creado_por: string
  autor_nombre: string | null
  created_at: string
  /** true si el usuario que consulta es el creador del recordatorio. */
  es_propio: boolean
}
