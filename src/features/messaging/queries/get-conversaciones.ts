import 'server-only'

import { getAulaNombresPorIds } from '@/features/aulas/queries/get-aula-nombres'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { ConversacionListItem } from '../types'

/**
 * Devuelve las conversaciones que el usuario puede leer (RLS filtra):
 *  - profe/admin del centro: todas las del centro,
 *  - tutor con `puede_recibir_mensajes`: solo las de sus niños.
 *
 * Ordenadas por `last_message_at DESC NULLS LAST` (índice
 * `conversaciones_centro_last_msg_idx`). Cada item lleva preview del
 * último mensaje no anulado y contador de no leídos (mensajes después
 * de `last_read_at` del usuario, excluyendo los propios y los anulados).
 *
 * El conteo de no leídos se hace en JS sobre las filas devueltas: el
 * volumen esperado por usuario es bajo (<50 conversaciones activas en
 * ANAIA), así que no compensa una vista SQL dedicada en Ola 1.
 */
export async function getConversacionesDelUsuario(): Promise<ConversacionListItem[]> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  // 1. Conversaciones con join al niño (nombre + aula actual del niño).
  // Limitar a `profe_familia` — la lista admin↔familia se sirve por
  // `getAdminFamiliaList(rol)` y se renderiza en una sección aparte de
  // `MessagesView`. El INNER JOIN con `ninos` también las filtraría en
  // runtime, pero el filtro explícito documenta la intención.
  const { data: convs, error: convErr } = await supabase
    .from('conversaciones')
    .select(
      `
      id,
      nino_id,
      last_message_at,
      nino:ninos!inner (
        nombre,
        apellidos,
        matriculas (
          aula_id,
          fecha_baja
        )
      )
      `
    )
    .eq('tipo_conversacion', 'profe_familia')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (convErr) {
    logger.warn('getConversacionesDelUsuario: conversaciones', convErr.message)
    return []
  }

  const conversaciones = convs ?? []
  if (conversaciones.length === 0) return []

  const convIds = conversaciones.map((c) => c.id)

  // 2. Último mensaje (no anulado) de cada conversación.
  // PostgREST no permite GROUP BY desde el cliente sin RPC; recogemos hasta
  // 100 mensajes recientes y los agrupamos en JS. Con ~50 conversaciones es
  // suficiente; si el volumen creciera, se convertiría en RPC SQL.
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

  // 3. Lecturas del usuario para esas conversaciones.
  const { data: lecturas } = await supabase
    .from('lectura_conversacion')
    .select('conversacion_id, last_read_at')
    .eq('usuario_id', userId)
    .in('conversacion_id', convIds)

  const lastReadByConv = new Map(lecturas?.map((l) => [l.conversacion_id, l.last_read_at]) ?? [])

  // 4. Conteo de no leídos: mensajes posteriores a last_read_at (o todos si
  //    no hay lectura previa), no anulados, no propios.
  const unreadByConv = new Map<string, number>()
  for (const m of msgs ?? []) {
    if (m.autor_id === userId || m.erroneo) continue
    const lastRead = lastReadByConv.get(m.conversacion_id)
    if (!lastRead || m.created_at > lastRead) {
      unreadByConv.set(m.conversacion_id, (unreadByConv.get(m.conversacion_id) ?? 0) + 1)
    }
  }

  // Filtro defensivo del nullable: tras `.eq('tipo_conversacion', 'profe_familia')`
  // + INNER JOIN con `ninos`, `c.nino_id` siempre está poblado, pero TS lo ve
  // como `string | null` por la columna nullable. Filtrar aquí cierra el narrow
  // sin cast ciego.
  // F11-H: resolución del nombre de aula por id (ya no se anida en matriculas).
  const matriculaDe = (c: (typeof conversaciones)[number]) =>
    c.nino?.matriculas?.find((m) => m.fecha_baja === null) ?? c.nino?.matriculas?.[0] ?? null
  const aulaNombres = await getAulaNombresPorIds(
    supabase,
    conversaciones.map((c) => matriculaDe(c)?.aula_id)
  )

  const items: ConversacionListItem[] = conversaciones
    .filter((c): c is typeof c & { nino_id: string } => c.nino_id !== null)
    .map((c) => {
      const matricula = matriculaDe(c)
      const last = lastByConv.get(c.id) ?? null
      return {
        id: c.id,
        nino_id: c.nino_id,
        nino_nombre: c.nino?.nombre ?? '',
        nino_apellidos: c.nino?.apellidos ?? '',
        aula_nombre: matricula?.aula_id ? (aulaNombres.get(matricula.aula_id) ?? null) : null,
        last_message_at: c.last_message_at,
        last_message_preview: last ? (last.erroneo ? null : last.contenido.slice(0, 140)) : null,
        unread_count: unreadByConv.get(c.id) ?? 0,
      }
    })

  return items
}
