import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types ------------------------------------------------------
export type EventoRow = Database['public']['Tables']['eventos']['Row']
export type EventoInsert = Database['public']['Tables']['eventos']['Insert']
export type ConfirmacionRow = Database['public']['Tables']['confirmaciones_evento']['Row']
export type AmbitoEvento = Database['public']['Enums']['ambito_evento']
export type TipoEvento = Database['public']['Enums']['tipo_evento']
export type EventoEstado = Database['public']['Enums']['evento_estado']
export type ConfirmacionEstado = Database['public']['Enums']['confirmacion_estado']

// --- View models para la UI --------------------------------------------------

/** Evento tal y como lo consume el calendario y el detalle. */
export interface EventoCalendario {
  id: string
  ambito: AmbitoEvento
  tipo: TipoEvento
  titulo: string
  descripcion: string | null
  lugar: string | null
  fecha: string
  fecha_fin: string | null
  hora_inicio: string | null
  hora_fin: string | null
  requiere_confirmacion: boolean
  estado: EventoEstado
  aula_id: string | null
  nino_id: string | null
}

/** Fila del roster de confirmaciones (staff) / del control de la familia.
 *  `estado='pendiente'` = no hay fila en `confirmaciones_evento` aún. */
export interface RosterConfirmacion {
  nino_id: string
  nino_nombre: string
  estado: ConfirmacionEstado
  comentario: string | null
  confirmado_at: string | null
}

/** Detalle de un evento + su roster (filtrado por RLS según el rol que consulta). */
export interface EventoDetalle {
  evento: EventoCalendario
  roster: RosterConfirmacion[]
  /** El usuario actual creó el evento. Junto a `esAdmin` gatea editar/cancelar (D8). */
  es_autor: boolean
}
