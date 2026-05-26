import 'server-only'

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
 */
export async function countNoLeidos(): Promise<UnreadCounts> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return { conversaciones: 0, anuncios: 0, total: 0 }

  // --- Conversaciones --------------------------------------------------
  const { data: convs, error: convErr } = await supabase
    .from('conversaciones')
    .select('id')
    .limit(200)

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
  const { data: anuncios, error: anErr } = await supabase
    .from('anuncios')
    .select('id, autor_id, erroneo')
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
