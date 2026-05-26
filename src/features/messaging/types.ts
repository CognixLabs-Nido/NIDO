import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types --------------------------------------------------
export type ConversacionRow = Database['public']['Tables']['conversaciones']['Row']
export type MensajeRow = Database['public']['Tables']['mensajes']['Row']
export type AnuncioRow = Database['public']['Tables']['anuncios']['Row']
export type LecturaConversacionRow = Database['public']['Tables']['lectura_conversacion']['Row']
export type LecturaAnuncioRow = Database['public']['Tables']['lectura_anuncio']['Row']
export type AmbitoAnuncio = Database['public']['Enums']['ambito_anuncio']

// --- View models para la UI ----------------------------------------------

/** Item de la lista de conversaciones para /messages. */
export interface ConversacionListItem {
  id: string
  nino_id: string
  nino_nombre: string
  nino_apellidos: string
  aula_nombre: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
}

/** Item de la lista de anuncios para /messages. */
export interface AnuncioListItem {
  id: string
  ambito: AmbitoAnuncio
  aula_id: string | null
  aula_nombre: string | null
  titulo: string
  contenido: string
  autor_id: string
  autor_nombre: string
  erroneo: boolean
  created_at: string
  leido: boolean
  es_propio: boolean
}

/** Mensaje renderizado en el hilo, ya enriquecido con datos del autor. */
export interface MensajeView {
  id: string
  conversacion_id: string
  autor_id: string
  autor_nombre: string
  autor_rol_label: 'profe' | 'tutor' | 'admin' | 'autor'
  contenido: string
  erroneo: boolean
  created_at: string
  es_propio: boolean
}

/** Datos de cabecera del hilo (datos del niño asociados a la conversación). */
export interface ConversacionHeader {
  id: string
  nino_id: string
  nino_nombre: string
  nino_apellidos: string
  aula_nombre: string | null
}

/** Detalle de un anuncio. */
export interface AnuncioDetalle {
  id: string
  ambito: AmbitoAnuncio
  aula_id: string | null
  aula_nombre: string | null
  centro_id: string
  titulo: string
  contenido: string
  erroneo: boolean
  created_at: string
  autor_id: string
  autor_nombre: string
  es_propio: boolean
  /** Solo poblado si soy el autor; null en caso contrario. */
  lectores?: {
    total: number
    leidos: number
  }
}

// --- Constantes ----------------------------------------------------------
export const PREFIX_ANULADO = '[anulado] '
