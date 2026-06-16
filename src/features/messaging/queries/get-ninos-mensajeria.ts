import 'server-only'

import {
  aplicarMatriculaActiva,
  esMatriculaActiva,
} from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface NinoMensajeriaItem {
  /** id del niño (no de la conversación). */
  nino_id: string
  nombre: string
  apellidos: string
  aula_nombre: string | null
  /** Si ya existe conversación: id; si no: null (el composer la crea al primer mensaje). */
  conversacion_id: string | null
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
}

/**
 * Lista de niños sobre los que el usuario actual puede mantener una
 * conversación (split-view de `/messages` para profe y tutor). Cada
 * item lleva el id de la conversación si ya existe; si no, `null`, y
 * el composer del split-view la crea al enviar el primer mensaje
 * (mismo patrón que `/messages/nino/[ninoId]/page.tsx`).
 *
 * Resolución por rol (RLS-friendly):
 *  - admin: vista panorámica de la mensajería del centro. La vista
 *    `/messages` para admin no muestra Conversaciones (solo Anuncios),
 *    pero la query devuelve todos los niños del centro por consistencia
 *    si se quisiera reactivar.
 *  - profe: niños con matrícula activa en aulas donde la profe tiene
 *    asignación activa.
 *  - tutor: niños vinculados al usuario con `puede_recibir_mensajes=true`.
 *
 * La query es deliberadamente "ancha": carga matriculas/vinculos/conversaciones
 * y los une en JS. Volumen esperado por usuario muy bajo (ANAIA tiene <50
 * niños activos). Si crece, conviene una RPC SQL dedicada.
 */
export async function getNinosMensajeriaParaUsuario(
  centroId: string,
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
): Promise<NinoMensajeriaItem[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  // 1. Universo de niños según rol.
  type NinoBase = {
    id: string
    nombre: string
    apellidos: string
    aula_nombre: string | null
  }
  const ninos: NinoBase[] = []

  if (rol === 'profe') {
    // Aulas activas del profe en el centro.
    const { data: asignaciones, error: asigErr } = await supabase
      .from('profes_aulas')
      .select('aula:aulas!inner(id, nombre, centro_id, deleted_at)')
      .eq('profe_id', userId)
      .is('fecha_fin', null)
      .is('deleted_at', null)

    if (asigErr) {
      logger.warn('getNinosMensajeriaParaUsuario: asignaciones', asigErr.message)
      return []
    }

    const aulasMap = new Map<string, string>() // aula_id -> nombre
    for (const a of asignaciones ?? []) {
      if (a.aula && a.aula.centro_id === centroId && a.aula.deleted_at === null) {
        aulasMap.set(a.aula.id, a.aula.nombre)
      }
    }
    if (aulasMap.size === 0) return []

    const aulaIds = Array.from(aulasMap.keys())
    const { data: matriculas, error: matErr } = await aplicarMatriculaActiva(
      supabase
        .from('matriculas')
        .select('aula_id, nino:ninos!inner(id, nombre, apellidos, deleted_at)')
        .in('aula_id', aulaIds)
    )

    if (matErr) {
      logger.warn('getNinosMensajeriaParaUsuario: matriculas profe', matErr.message)
      return []
    }

    const seen = new Set<string>()
    for (const m of matriculas ?? []) {
      if (!m.nino || m.nino.deleted_at !== null) continue
      if (seen.has(m.nino.id)) continue
      seen.add(m.nino.id)
      ninos.push({
        id: m.nino.id,
        nombre: m.nino.nombre,
        apellidos: m.nino.apellidos,
        aula_nombre: aulasMap.get(m.aula_id) ?? null,
      })
    }
  } else if (rol === 'tutor_legal' || rol === 'autorizado') {
    // Vínculos del tutor con permiso de recibir mensajes (RLS extra: el
    // filtro JSONB de permisos vive en el helper SQL, pero filtramos
    // localmente para no traer niños sin permiso).
    const { data: vinculos, error: vErr } = await supabase
      .from('vinculos_familiares')
      .select(
        'permisos, nino:ninos!inner(id, nombre, apellidos, centro_id, deleted_at, matriculas(aula_id, fecha_baja, deleted_at, estado, aula:aulas(nombre)))'
      )
      .eq('usuario_id', userId)
      .is('deleted_at', null)

    if (vErr) {
      logger.warn('getNinosMensajeriaParaUsuario: vinculos', vErr.message)
      return []
    }

    for (const v of vinculos ?? []) {
      if (!v.nino || v.nino.deleted_at !== null) continue
      if (v.nino.centro_id !== centroId) continue
      const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
      if (permisos.puede_recibir_mensajes !== true) continue

      const matriculaActiva = v.nino.matriculas?.find((m) => esMatriculaActiva(m)) ?? null

      ninos.push({
        id: v.nino.id,
        nombre: v.nino.nombre,
        apellidos: v.nino.apellidos,
        aula_nombre: matriculaActiva?.aula?.nombre ?? null,
      })
    }
  } else if (rol === 'admin') {
    // Admin no usa el tab Conversaciones en la UI actual, pero devolvemos
    // todos los niños del centro por consistencia (futuras vistas).
    const { data: matriculas, error: matErr } = await aplicarMatriculaActiva(
      supabase
        .from('matriculas')
        .select(
          'aula_id, nino:ninos!inner(id, nombre, apellidos, centro_id, deleted_at), aula:aulas(nombre)'
        )
    )

    if (matErr) {
      logger.warn('getNinosMensajeriaParaUsuario: matriculas admin', matErr.message)
      return []
    }
    const seen = new Set<string>()
    for (const m of matriculas ?? []) {
      if (!m.nino || m.nino.deleted_at !== null) continue
      if (m.nino.centro_id !== centroId) continue
      if (seen.has(m.nino.id)) continue
      seen.add(m.nino.id)
      ninos.push({
        id: m.nino.id,
        nombre: m.nino.nombre,
        apellidos: m.nino.apellidos,
        aula_nombre: m.aula?.nombre ?? null,
      })
    }
  }

  if (ninos.length === 0) return []

  // 2. Conversaciones existentes (RLS filtra).
  const ninoIds = ninos.map((n) => n.id)
  const { data: convs } = await supabase
    .from('conversaciones')
    .select('id, nino_id, last_message_at')
    .in('nino_id', ninoIds)

  const convByNino = new Map(convs?.map((c) => [c.nino_id, c]) ?? [])
  const convIds = (convs ?? []).map((c) => c.id)

  // 3. Último mensaje no anulado de cada conversación.
  const lastByConv = new Map<string, { contenido: string; erroneo: boolean; created_at: string }>()
  const unreadByConv = new Map<string, number>()
  if (convIds.length > 0) {
    const [{ data: msgs }, { data: lecturas }] = await Promise.all([
      supabase
        .from('mensajes')
        .select('conversacion_id, contenido, erroneo, created_at, autor_id')
        .in('conversacion_id', convIds)
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('lectura_conversacion')
        .select('conversacion_id, last_read_at')
        .eq('usuario_id', userId)
        .in('conversacion_id', convIds),
    ])

    const lastReadByConv = new Map(lecturas?.map((l) => [l.conversacion_id, l.last_read_at]) ?? [])

    for (const m of msgs ?? []) {
      if (!lastByConv.has(m.conversacion_id)) {
        lastByConv.set(m.conversacion_id, {
          contenido: m.contenido,
          erroneo: m.erroneo,
          created_at: m.created_at,
        })
      }
      if (m.autor_id === userId || m.erroneo) continue
      const lr = lastReadByConv.get(m.conversacion_id)
      if (!lr || m.created_at > lr) {
        unreadByConv.set(m.conversacion_id, (unreadByConv.get(m.conversacion_id) ?? 0) + 1)
      }
    }
  }

  // 4. Componer items y ordenar: con conversación reciente primero,
  //    luego niños sin conversación (alfabético).
  const items: NinoMensajeriaItem[] = ninos.map((n) => {
    const conv = convByNino.get(n.id)
    const last = conv ? lastByConv.get(conv.id) : null
    return {
      nino_id: n.id,
      nombre: n.nombre,
      apellidos: n.apellidos,
      aula_nombre: n.aula_nombre,
      conversacion_id: conv?.id ?? null,
      last_message_at: conv?.last_message_at ?? null,
      last_message_preview: last ? (last.erroneo ? null : last.contenido.slice(0, 140)) : null,
      unread_count: conv ? (unreadByConv.get(conv.id) ?? 0) : 0,
    }
  })

  items.sort((a, b) => {
    // Primero los que tienen actividad reciente.
    if (a.last_message_at && b.last_message_at) {
      return b.last_message_at.localeCompare(a.last_message_at)
    }
    if (a.last_message_at) return -1
    if (b.last_message_at) return 1
    // Sin actividad: alfabético por nombre + apellidos.
    return `${a.nombre} ${a.apellidos}`.localeCompare(`${b.nombre} ${b.apellidos}`)
  })

  return items
}
