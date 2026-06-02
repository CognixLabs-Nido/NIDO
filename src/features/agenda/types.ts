import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types ------------------------------------------------------
export type CitaRow = Database['public']['Tables']['citas']['Row']
export type CitaInsert = Database['public']['Tables']['citas']['Insert']
export type CitaInvitadoRow = Database['public']['Tables']['cita_invitados']['Row']
export type CitaInvitadoInsert = Database['public']['Tables']['cita_invitados']['Insert']
export type PreferenciaUsuarioRow = Database['public']['Tables']['preferencias_usuario']['Row']

export type TipoCita = Database['public']['Enums']['tipo_cita']
export type CitaEstado = Database['public']['Enums']['cita_estado']
export type RsvpEstado = Database['public']['Enums']['rsvp_estado']

/** Clave de preferencia persistida para la vista de la Agenda (AG-07). */
export const PREF_VISTA_AGENDA = 'agenda_vista'
export type VistaAgenda = 'dia' | 'semana' | 'mes'
export const VISTA_AGENDA_DEFAULT: VistaAgenda = 'dia'

// --- View models para la UI --------------------------------------------------

/** Cita tal y como la consumen las vistas día/semana/mes y el detalle. */
export interface CitaAgenda {
  id: string
  tipo: TipoCita
  titulo: string
  descripcion: string | null
  lugar: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string | null
  estado: CitaEstado
  aula_id: string | null
  nino_id: string | null
  /** El usuario actual organiza esta cita (gatea editar/cancelar/roster, AG-11). */
  es_organizador: boolean
  /** RSVP del usuario actual si es invitado interno; null si solo organiza/admin. */
  mi_estado: RsvpEstado | null
}

/** Fila del roster de invitados (visible solo a organizador/admin — roster privado). */
export interface InvitadoRoster {
  id: string
  /** usuario interno; null si es externo-texto. */
  usuario_id: string | null
  /** Nombre a mostrar: del usuario interno o el `nombre_externo`. */
  nombre: string
  es_externo: boolean
  estado: RsvpEstado
  respondido_at: string | null
  comentario: string | null
}

/** Detalle de una cita + su roster (filtrado por RLS según el rol que consulta). */
export interface CitaDetalle {
  cita: CitaAgenda
  /** Lista completa solo para organizador/admin; vacía para un invitado (roster privado). */
  roster: InvitadoRoster[]
  recuento: { pendiente: number; aceptado: number; rechazado: number }
}
