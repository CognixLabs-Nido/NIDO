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

/** Profe activo del aula a efectos del header de la conversación. */
export interface ProfeAula {
  usuario_id: string
  nombre_completo: string
  es_principal: boolean
}

/** Datos de cabecera del hilo. Incluye profes activos del aula del niño
 *  para que la UI del tutor pueda mostrarlos en lugar del nombre del niño. */
export interface ConversacionHeader {
  id: string
  nino_id: string
  nino_nombre: string
  nino_apellidos: string
  aula_nombre: string | null
  /** Profes activos del aula actual del niño. Vacío si el niño no tiene
   *  matrícula activa o no hay profes asignados. Ordenados con el principal
   *  primero, después por nombre. */
  profes_aula: ProfeAula[]
}

// --- F5.6-A — admin ↔ familia --------------------------------------------

/** Header del hilo admin_familia. Carece de niño/aula; el "otro miembro"
 *  del par se identifica por nombre + id. `expires_at` siempre poblado
 *  (lo enforza el CHECK estructural). */
export interface ConversacionAdminFamiliaHeader {
  id: string
  admin_id: string
  admin_nombre: string
  tutor_id: string
  tutor_nombre: string
  expires_at: string
}

/** F5B-Items1+2 — Item de la lista de tutores para el split-view del admin
 *  en `/messages` tab Dirección. Un row por tutor con vínculo activo en
 *  el centro (dedup por `usuario_id`), con sus hijos del centro y el hilo
 *  `(admin=auth.uid(), tutor=usuario_id)` si existe. */
export interface TutorDireccionItem {
  usuario_id: string
  nombre_completo: string
  hijos: Array<{
    nino_id: string
    nombre: string
    apellidos: string
  }>
  /** Hilo `(admin=auth.uid(), tutor=usuario_id)` si existe. */
  conversacion_id: string | null
  /** Solo si `conversacion_id !== null`. */
  expires_at: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
}

/** Item de lista de hilos admin_familia. Se usa tanto para el tab admin
 *  como para la sección "Dirección" del tutor (0 ó 1 item). */
export interface AdminFamiliaListItem {
  id: string
  /** El nombre del *otro* miembro del par, calculado server-side según
   *  quién consulta. Para el admin → nombre del tutor; para el tutor →
   *  nombre del admin. La query no expone ambos para mantener simple
   *  el render. */
  contraparte_nombre: string
  /** Indica qué papel juega el caller en este hilo. Determina si la UI
   *  puede mostrar "Reabrir conversación" (solo admin). */
  rol_en_hilo: 'admin' | 'tutor'
  expires_at: string
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
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
