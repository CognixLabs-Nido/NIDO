import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { ConversacionAdminFamiliaHeader, MensajeView } from '../types'

interface ConversacionAdminFamiliaDetalle {
  header: ConversacionAdminFamiliaHeader
  mensajes: MensajeView[]
  /** El rol del caller en este hilo. `admin` puede reabrir; `tutor` no. */
  rolEnHilo: 'admin' | 'tutor'
}

/**
 * Detalle de una conversación admin_familia: header + mensajes recientes.
 *
 * RLS de `conversaciones_select` filtra: solo el `admin_id` y el `tutor_id`
 * concretos ven el hilo. Si la conversación no es admin_familia o el caller
 * no participa, devuelve `null` (el page hace dispatch al fallback).
 *
 * Diferencia con `getConversacionDetalle` (profe_familia): aquí NO hay
 * niño, ni aula, ni profes; el "otro miembro" del par es el campo que se
 * muestra en el header.
 */
export async function getAdminFamiliaDetalle(
  conversacionId: string
): Promise<ConversacionAdminFamiliaDetalle | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: conv, error: convErr } = await supabase
    .from('conversaciones')
    .select(
      `
      id,
      tipo_conversacion,
      admin_id,
      tutor_id,
      expires_at,
      admin:usuarios!conversaciones_admin_id_fkey (nombre_completo),
      tutor:usuarios!conversaciones_tutor_id_fkey (nombre_completo)
      `
    )
    .eq('id', conversacionId)
    .maybeSingle()

  if (convErr) {
    logger.warn('getAdminFamiliaDetalle: conversacion', convErr.message)
    return null
  }
  if (!conv) return null
  if (conv.tipo_conversacion !== 'admin_familia') return null
  if (!conv.admin_id || !conv.tutor_id || !conv.expires_at) return null

  const rolEnHilo: 'admin' | 'tutor' =
    conv.admin_id === userId ? 'admin' : conv.tutor_id === userId ? 'tutor' : 'tutor'

  // 200 mensajes recientes en orden ascendente (más antiguo arriba). Mismo
  // patrón que `getConversacionDetalle`; si crece el volumen se paginará.
  const { data: mensajes, error: msgErr } = await supabase
    .from('mensajes')
    .select(
      `
      id,
      conversacion_id,
      autor_id,
      contenido,
      erroneo,
      created_at,
      autor:usuarios!mensajes_autor_id_fkey (nombre_completo)
      `
    )
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (msgErr) {
    logger.warn('getAdminFamiliaDetalle: mensajes', msgErr.message)
    return null
  }

  // Mapeo de rol del autor. En admin_familia solo hay dos autores posibles:
  // el admin del par y el tutor del par. Comparamos con los ids del hilo
  // — más barato que ir a `roles_usuario`.
  const mensajesView: MensajeView[] = (mensajes ?? []).map((m) => {
    const label: MensajeView['autor_rol_label'] =
      m.autor_id === userId ? 'autor' : m.autor_id === conv.admin_id ? 'admin' : 'tutor'
    return {
      id: m.id,
      conversacion_id: m.conversacion_id,
      autor_id: m.autor_id,
      autor_nombre: m.autor?.nombre_completo ?? '',
      autor_rol_label: label,
      contenido: m.contenido,
      erroneo: m.erroneo,
      created_at: m.created_at,
      es_propio: m.autor_id === userId,
    }
  })

  return {
    header: {
      id: conv.id,
      admin_id: conv.admin_id,
      admin_nombre: conv.admin?.nombre_completo ?? '',
      tutor_id: conv.tutor_id,
      tutor_nombre: conv.tutor?.nombre_completo ?? '',
      expires_at: conv.expires_at,
    },
    mensajes: mensajesView,
    rolEnHilo,
  }
}
