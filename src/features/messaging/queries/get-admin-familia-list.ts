import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AdminFamiliaListItem } from '../types'

/**
 * Lista de hilos admin_familia del usuario actual.
 *
 *  - Admin: todas las conversaciones donde `admin_id = auth.uid()`
 *    (bandeja de salida del admin). Vista del tab "Dirección" en
 *    `/messages` para rol admin.
 *  - Tutor: las conversaciones donde `tutor_id = auth.uid()`. Vista de
 *    la sección "Dirección" del tab Conversaciones en `/messages`
 *    para tutor/autorizado. Habrá 0 o 1 hilo por admin que le haya
 *    escrito.
 *
 * RLS de `conversaciones_select` filtra: el caller solo ve los rows
 * donde es el `admin_id` o el `tutor_id` concreto del par. Por
 * coherencia se aplica también el filtro en cliente para defense in
 * depth.
 *
 * Para cada hilo se calcula:
 *  - `contraparte_nombre`: el nombre del OTRO miembro del par.
 *  - `rol_en_hilo`: 'admin' o 'tutor' según el caller.
 *  - `last_message_preview` y `last_message_at`: del último mensaje
 *    no-anulado.
 *  - `unread_count`: mensajes posteriores a la última lectura del
 *    caller, no anulados, no propios.
 */
export async function getAdminFamiliaList(
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
): Promise<AdminFamiliaListItem[]> {
  // Profes no participan en admin_familia. Devuelve lista vacía sin pegar
  // a la BD para no introducir queries innecesarias en su /messages.
  if (rol === 'profe') return []

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  const filtroCampo = rol === 'admin' ? 'admin_id' : 'tutor_id'

  const { data: convs, error: convErr } = await supabase
    .from('conversaciones')
    .select(
      `
      id,
      admin_id,
      tutor_id,
      expires_at,
      last_message_at,
      admin:usuarios!conversaciones_admin_id_fkey (nombre_completo),
      tutor:usuarios!conversaciones_tutor_id_fkey (nombre_completo)
      `
    )
    .eq('tipo_conversacion', 'admin_familia')
    .eq(filtroCampo, userId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (convErr) {
    logger.warn('getAdminFamiliaList: conversaciones', convErr.message)
    return []
  }

  const conversaciones = convs ?? []
  if (conversaciones.length === 0) return []

  const convIds = conversaciones.map((c) => c.id)

  // Último mensaje (no anulado) por hilo. Mismo patrón que `get-conversaciones.ts`:
  // recogemos los 500 más recientes y agrupamos en JS. Volumen esperado bajo
  // (un admin tendrá pocos hilos activos).
  const { data: msgs } = await supabase
    .from('mensajes')
    .select('id, conversacion_id, contenido, erroneo, created_at, autor_id')
    .in('conversacion_id', convIds)
    .order('created_at', { ascending: false })
    .limit(500)

  const lastByConv = new Map<string, { contenido: string; erroneo: boolean; created_at: string }>()
  for (const m of msgs ?? []) {
    if (!lastByConv.has(m.conversacion_id)) {
      lastByConv.set(m.conversacion_id, {
        contenido: m.contenido,
        erroneo: m.erroneo,
        created_at: m.created_at,
      })
    }
  }

  // Lecturas del usuario para esos hilos.
  const { data: lecturas } = await supabase
    .from('lectura_conversacion')
    .select('conversacion_id, last_read_at')
    .eq('usuario_id', userId)
    .in('conversacion_id', convIds)

  const lastReadByConv = new Map(lecturas?.map((l) => [l.conversacion_id, l.last_read_at]) ?? [])

  const unreadByConv = new Map<string, number>()
  for (const m of msgs ?? []) {
    if (m.autor_id === userId || m.erroneo) continue
    const lastRead = lastReadByConv.get(m.conversacion_id)
    if (!lastRead || m.created_at > lastRead) {
      unreadByConv.set(m.conversacion_id, (unreadByConv.get(m.conversacion_id) ?? 0) + 1)
    }
  }

  const items: AdminFamiliaListItem[] = conversaciones
    .filter((c) => c.expires_at && c.admin_id && c.tutor_id)
    .map((c) => {
      const last = lastByConv.get(c.id) ?? null
      const rolEnHilo: 'admin' | 'tutor' = c.admin_id === userId ? 'admin' : 'tutor'
      const contraparte =
        rolEnHilo === 'admin' ? (c.tutor?.nombre_completo ?? '') : (c.admin?.nombre_completo ?? '')
      return {
        id: c.id,
        contraparte_nombre: contraparte,
        rol_en_hilo: rolEnHilo,
        expires_at: c.expires_at!,
        last_message_at: c.last_message_at,
        last_message_preview: last ? (last.erroneo ? null : last.contenido.slice(0, 140)) : null,
        unread_count: unreadByConv.get(c.id) ?? 0,
      }
    })

  return items
}
