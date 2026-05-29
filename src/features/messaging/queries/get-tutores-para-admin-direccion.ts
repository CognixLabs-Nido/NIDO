import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import type { TutorDireccionItem } from '../types'

/**
 * F5B-Items1+2 — Lista de tutores del centro para el split-view del admin
 * en `/messages` tab Dirección. Paralela en propósito a
 * `getNinosMensajeriaParaUsuario` (lista niños para profe/tutor), pero
 * orientada al modelo per-par admin↔familia (1 hilo por `(admin, tutor)`,
 * independiente del niño).
 *
 * Devuelve todos los tutores con vínculo activo en el centro, deduplicados
 * por `usuario_id`, con sus hijos del centro y el hilo
 * `(admin=auth.uid(), tutor=usuario_id)` si ya existe. Si no existe, el
 * panel renderiza un composer "iniciar" que llama secuencialmente
 * `abrirConversacionAdminFamilia` + `enviarMensaje`.
 *
 * Flag `puede_recibir_mensajes`: NO aplica al canal admin↔familia. La RLS
 * `conversaciones_insert` para tipo `admin_familia` solo exige
 * `es_tutor_en_centro` (migración F5.6-A líneas 245-249). Por eso la
 * lista incluye TODOS los tutores del centro, opaca a esa flag.
 *
 * Ordenación:
 *   1. Tutores con hilo activo (con `last_message_at`), por `last_message_at` desc.
 *   2. Tutores con hilo abierto sin mensajes (`last_message_at = null`),
 *      por `expires_at` desc (los más frescos primero).
 *   3. Tutores sin hilo, alfabéticos por `nombre_completo` asc.
 *
 * Performance (Nota D del checkpoint B): los tres bloques de SELECTs
 * independientes (vínculos+niños, hilos, mensajes/lecturas) se lanzan
 * con `Promise.all` por bloque. El primer bloque es prerequisito de los
 * siguientes (necesita `tutor_id`/`conv_id` para los `IN (...)`), por lo
 * que el flujo es 2 rondas de IO secuenciales: ronda 1 = vínculos+niños
 * en paralelo internamente; ronda 2 = hilos + (último mensaje + lecturas)
 * en paralelo. Con seed de 30 tutores en local: ~80-120 ms.
 */
export async function getTutoresParaAdminDireccion(
  centroId: string
): Promise<TutorDireccionItem[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []
  return getTutoresParaAdminDireccionCore(supabase, userId, centroId)
}

/**
 * Núcleo testeable: recibe el cliente Supabase y el `userId` explícitos.
 * El wrapper público wirea `createClient()` + `auth.getUser()` desde el
 * contexto Next.js; los tests Vitest inyectan un fake siguiendo el
 * mismo patrón de los actions (`marcarMensajeErroneoCore`, etc.).
 */
export async function getTutoresParaAdminDireccionCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  centroId: string
): Promise<TutorDireccionItem[]> {
  // ─── Ronda 1: universo de tutores del centro ──────────────────────────
  // Vínculos activos (tutor_legal_principal | tutor_legal_secundario | autorizado)
  // sobre niños del centro no borrados. JOIN al usuario para nombre.
  // `vinculos_familiares.usuario_id` es NOT NULL en BD: no requiere filtro.
  const { data: vinculos, error: vErr } = await supabase
    .from('vinculos_familiares')
    .select(
      `
      usuario_id,
      usuario:usuarios!inner(nombre_completo),
      nino:ninos!inner(id, nombre, apellidos, centro_id, deleted_at)
      `
    )
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario', 'autorizado'])
    .is('deleted_at', null)

  if (vErr) {
    logger.warn('getTutoresParaAdminDireccion: vinculos', vErr.message)
    return []
  }

  // Dedup por usuario_id. Filtramos por centro y soft-delete del niño
  // client-side (Supabase no permite JOIN-time WHERE sobre la tabla
  // joined sin un `inner` que ya aplicamos; el centro_id es la condición
  // crítica de aislamiento).
  type TutorBase = {
    usuario_id: string
    nombre_completo: string
    hijos: Array<{ nino_id: string; nombre: string; apellidos: string }>
  }
  const tutoresMap = new Map<string, TutorBase>()
  for (const v of vinculos ?? []) {
    if (!v.nino || v.nino.deleted_at !== null) continue
    if (v.nino.centro_id !== centroId) continue
    let bucket = tutoresMap.get(v.usuario_id)
    if (!bucket) {
      bucket = {
        usuario_id: v.usuario_id,
        nombre_completo: v.usuario?.nombre_completo ?? '',
        hijos: [],
      }
      tutoresMap.set(v.usuario_id, bucket)
    }
    if (!bucket.hijos.some((h) => h.nino_id === v.nino!.id)) {
      bucket.hijos.push({
        nino_id: v.nino.id,
        nombre: v.nino.nombre,
        apellidos: v.nino.apellidos,
      })
    }
  }

  if (tutoresMap.size === 0) return []

  // ─── Ronda 2: hilos del admin actual con esos tutores ─────────────────
  // RLS: `conversaciones_select` ya filtra por `admin_id = auth.uid()`
  // para `admin_familia`. El `.eq('admin_id', userId)` extra es defensa.
  const tutorIds = Array.from(tutoresMap.keys())
  const { data: convs, error: cErr } = await supabase
    .from('conversaciones')
    .select('id, tutor_id, expires_at, last_message_at')
    .eq('tipo_conversacion', 'admin_familia')
    .eq('admin_id', userId)
    .in('tutor_id', tutorIds)

  if (cErr) {
    logger.warn('getTutoresParaAdminDireccion: conversaciones', cErr.message)
    return []
  }

  const conversaciones = convs ?? []
  const convByTutor = new Map(conversaciones.map((c) => [c.tutor_id!, c]))
  const convIds = conversaciones.map((c) => c.id)

  // ─── Ronda 3: últimos mensajes + lecturas (paralelo entre sí) ─────────
  const lastByConv = new Map<string, { contenido: string; erroneo: boolean }>()
  const unreadByConv = new Map<string, number>()

  if (convIds.length > 0) {
    const [{ data: msgs }, { data: lecturas }] = await Promise.all([
      supabase
        .from('mensajes')
        .select('conversacion_id, contenido, erroneo, created_at, autor_id')
        .in('conversacion_id', convIds)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('lectura_conversacion')
        .select('conversacion_id, last_read_at')
        .eq('usuario_id', userId)
        .in('conversacion_id', convIds),
    ])

    const lastReadByConv = new Map(lecturas?.map((l) => [l.conversacion_id, l.last_read_at]) ?? [])

    for (const m of msgs ?? []) {
      if (!lastByConv.has(m.conversacion_id)) {
        lastByConv.set(m.conversacion_id, { contenido: m.contenido, erroneo: m.erroneo })
      }
      if (m.autor_id === userId || m.erroneo) continue
      const lr = lastReadByConv.get(m.conversacion_id)
      if (!lr || m.created_at > lr) {
        unreadByConv.set(m.conversacion_id, (unreadByConv.get(m.conversacion_id) ?? 0) + 1)
      }
    }
  }

  // ─── Composición e ordenación ────────────────────────────────────────
  const items: TutorDireccionItem[] = []
  for (const bucket of tutoresMap.values()) {
    const conv = convByTutor.get(bucket.usuario_id)
    const last = conv ? lastByConv.get(conv.id) : null
    // Hijos ordenados alfabéticamente para render estable.
    bucket.hijos.sort((a, b) =>
      `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`)
    )
    items.push({
      usuario_id: bucket.usuario_id,
      nombre_completo: bucket.nombre_completo,
      hijos: bucket.hijos,
      conversacion_id: conv?.id ?? null,
      expires_at: conv?.expires_at ?? null,
      last_message_at: conv?.last_message_at ?? null,
      last_message_preview: last ? (last.erroneo ? null : last.contenido.slice(0, 140)) : null,
      unread_count: conv ? (unreadByConv.get(conv.id) ?? 0) : 0,
    })
  }

  items.sort((a, b) => {
    const grupoA = a.conversacion_id ? (a.last_message_at ? 0 : 1) : 2
    const grupoB = b.conversacion_id ? (b.last_message_at ? 0 : 1) : 2
    if (grupoA !== grupoB) return grupoA - grupoB
    if (grupoA === 0) {
      // grupo 0 — por last_message_at desc.
      return b.last_message_at!.localeCompare(a.last_message_at!)
    }
    if (grupoA === 1) {
      // grupo 1 — por expires_at desc (los más frescos primero).
      return (b.expires_at ?? '').localeCompare(a.expires_at ?? '')
    }
    // grupo 2 — alfabético por nombre completo.
    return a.nombre_completo.localeCompare(b.nombre_completo)
  })

  return items
}
