import 'server-only'

import { rolesEnCentro } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface UnreadCounts {
  conversaciones: number
  anuncios: number
  total: number
}

/**
 * Suma de mensajes y anuncios sin leer para el usuario actual. La RLS de
 * SELECT filtra: solo entran filas que el usuario puede leer (es decir,
 * conversaciones donde participa y anuncios cuya audiencia incluye al
 * usuario — `puede_recibir_mensajes=false` ⇒ vacío).
 *
 * Conversaciones: mensajes no propios, no anulados, posteriores a
 * `last_read_at` del usuario (o todos si no hay marker).
 *
 * Anuncios: anuncios no propios, no anulados, sin fila en
 * `lectura_anuncio` para este usuario.
 *
 * El cálculo se hace en JS sobre las filas filtradas por RLS. Si el
 * volumen creciera, conviene una RPC SQL con un único roundtrip.
 *
 * `centroId`: el centro de la página (el activo). Decide si el usuario cuenta como admin y acota
 * las conversaciones (de profe/tutor) y los anuncios a ese centro; no lee la cookie (lo pasa el
 * layout, o el badge desde el cliente).
 */
export async function countNoLeidos(centroId: string): Promise<UnreadCounts> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return { conversaciones: 0, anuncios: 0, total: 0 }

  // --- Conversaciones --------------------------------------------------
  // El admin del centro tiene SELECT por RLS sobre TODAS las conversaciones
  // profe↔familia del centro (supervisión), pero NO participa en ellas: no
  // debe recibir avisos de no-leídos de mensajes privados profe↔tutor. Por
  // eso, para admin restringimos el conteo a sus propios hilos admin↔familia
  // (donde sí es interlocutor). Profe/tutor ya solo ven los suyos por RLS, pero de TODOS sus
  // centros: se acotan al de la página (multicentro). La del admin, igual: su hilo
  // dirección↔familia es uno por centro (PR B de la Fase 2).
  const rol = (await rolesEnCentro(supabase, userId, centroId))?.rol ?? null

  let convQuery = supabase.from('conversaciones').select('id').eq('centro_id', centroId)
  if (rol === 'admin') {
    // Multicentro (Fase 2 · PR B): un hilo dirección↔familia por centro; los de este.
    convQuery = convQuery.eq('tipo_conversacion', 'admin_familia').eq('admin_id', userId)
  }
  const { data: convs, error: convErr } = await convQuery.limit(200)

  if (convErr) {
    logger.warn('countNoLeidos: conversaciones', convErr.message)
  }
  const convIds = (convs ?? []).map((c) => c.id)

  let convsUnread = 0
  if (convIds.length > 0) {
    const [{ data: msgs }, { data: lecturas }] = await Promise.all([
      supabase
        .from('mensajes')
        .select('conversacion_id, autor_id, created_at, erroneo')
        .in('conversacion_id', convIds)
        .neq('autor_id', userId)
        .eq('erroneo', false)
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('lectura_conversacion')
        .select('conversacion_id, last_read_at')
        .eq('usuario_id', userId)
        .in('conversacion_id', convIds),
    ])

    const lastRead = new Map(lecturas?.map((l) => [l.conversacion_id, l.last_read_at]) ?? [])
    for (const m of msgs ?? []) {
      const lr = lastRead.get(m.conversacion_id)
      if (!lr || m.created_at > lr) convsUnread++
    }
  }

  // --- Anuncios --------------------------------------------------------
  // La RLS deja leer los anuncios de todos sus centros: solo cuentan los del de la página.
  const { data: anuncios, error: anErr } = await supabase
    .from('anuncios')
    .select('id, autor_id, erroneo')
    .eq('centro_id', centroId)
    .eq('erroneo', false)
    .neq('autor_id', userId)
    .limit(500)
  if (anErr) {
    logger.warn('countNoLeidos: anuncios', anErr.message)
  }

  let anunciosUnread = 0
  if (anuncios && anuncios.length > 0) {
    const ids = anuncios.map((a) => a.id)
    const { data: lecturas } = await supabase
      .from('lectura_anuncio')
      .select('anuncio_id')
      .eq('usuario_id', userId)
      .in('anuncio_id', ids)
    const leidos = new Set(lecturas?.map((l) => l.anuncio_id) ?? [])
    for (const a of anuncios) {
      if (!leidos.has(a.id)) anunciosUnread++
    }
  }

  return {
    conversaciones: convsUnread,
    anuncios: anunciosUnread,
    total: convsUnread + anunciosUnread,
  }
}
