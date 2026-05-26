import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { ConversacionHeader, MensajeView, ProfeAula } from '../types'

interface ConversacionDetalle {
  header: ConversacionHeader
  mensajes: MensajeView[]
  participo: boolean
}

/**
 * Devuelve la cabecera de la conversación (datos del niño + aula actual)
 * más los últimos 200 mensajes en orden ascendente (más antiguo arriba).
 *
 * RLS filtra: SELECT vía `puede_participar_conversacion(id)`. Si la
 * conversación no es accesible para el usuario, devuelve `null`.
 *
 * `participo` indica si el usuario actual es participante "activo"
 * (profe del aula del niño o tutor con permiso) y por tanto puede
 * escribir. Admin observador del centro tiene SELECT pero `participo`
 * sigue siendo true (RLS le deja insertar mensajes si quiere intervenir).
 */
export async function getConversacionDetalle(
  conversacionId: string
): Promise<ConversacionDetalle | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: conv, error: convErr } = await supabase
    .from('conversaciones')
    .select(
      `
      id,
      nino_id,
      nino:ninos!inner (
        nombre,
        apellidos,
        matriculas (
          aula_id,
          fecha_baja,
          aula:aulas (nombre)
        )
      )
      `
    )
    .eq('id', conversacionId)
    .maybeSingle()

  if (convErr) {
    logger.warn('getConversacionDetalle: conversacion', convErr.message)
    return null
  }
  if (!conv) return null

  // RLS ya lo filtra: si llega aquí, el usuario puede leer la conversación.
  // Para saber si "participa" (puede escribir) re-evaluamos el helper SQL.
  const { data: participoData } = await supabase.rpc('puede_participar_conversacion', {
    p_conversacion_id: conversacionId,
  })
  const participo = participoData === true

  // 200 mensajes recientes en orden ascendente. Si crece el volumen, se
  // pagina hacia atrás con un cursor `created_at < cursor`.
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
    logger.warn('getConversacionDetalle: mensajes', msgErr.message)
    return null
  }

  // Determinar rol del autor en el centro (para el label visual del mensaje).
  const autorIds = Array.from(new Set((mensajes ?? []).map((m) => m.autor_id)))
  const { data: rolesData } = autorIds.length
    ? await supabase
        .from('roles_usuario')
        .select('usuario_id, rol')
        .in('usuario_id', autorIds)
        .is('deleted_at', null)
    : { data: [] }

  const rolByUser = new Map<string, 'admin' | 'profe' | 'tutor_legal' | 'autorizado' | 'service'>()
  for (const r of rolesData ?? []) {
    // Si un usuario tiene múltiples roles en distintos centros, nos quedamos
    // con el primero "no autorizado" como el más representativo.
    const existing = rolByUser.get(r.usuario_id)
    if (!existing || (existing === 'autorizado' && r.rol !== 'autorizado')) {
      rolByUser.set(r.usuario_id, r.rol)
    }
  }

  const mensajesView: MensajeView[] = (mensajes ?? []).map((m) => {
    const rol = rolByUser.get(m.autor_id)
    const label: MensajeView['autor_rol_label'] =
      rol === 'admin' ? 'admin' : rol === 'profe' ? 'profe' : 'tutor'
    return {
      id: m.id,
      conversacion_id: m.conversacion_id,
      autor_id: m.autor_id,
      autor_nombre: m.autor?.nombre_completo ?? '',
      autor_rol_label: m.autor_id === userId ? 'autor' : label,
      contenido: m.contenido,
      erroneo: m.erroneo,
      created_at: m.created_at,
      es_propio: m.autor_id === userId,
    }
  })

  const matricula =
    conv.nino?.matriculas?.find((m) => m.fecha_baja === null) ?? conv.nino?.matriculas?.[0] ?? null

  // Profes activos del aula actual del niño. Para la vista del tutor: la
  // cabecera muestra al/los profe(s) en lugar del nombre del niño. La RLS
  // de `profes_aulas` permite a participantes de la conversación (admin
  // del centro, profe del aula y tutor con permiso sobre el niño) leer
  // esta tabla. Si la query falla o devuelve vacío, el header se renderiza
  // con fallback a "Aula X" sin profe.
  let profes_aula: ProfeAula[] = []
  if (matricula?.aula_id) {
    const { data: asignaciones, error: profesErr } = await supabase
      .from('profes_aulas')
      .select('profe_id, es_profe_principal, profe:usuarios!inner(nombre_completo)')
      .eq('aula_id', matricula.aula_id)
      .is('fecha_fin', null)
      .is('deleted_at', null)

    if (profesErr) {
      logger.warn('getConversacionDetalle: profes_aulas', profesErr.message)
    } else {
      profes_aula = (asignaciones ?? [])
        .filter((a): a is typeof a & { profe: { nombre_completo: string } } => a.profe !== null)
        .map((a) => ({
          usuario_id: a.profe_id,
          nombre_completo: a.profe.nombre_completo,
          es_principal: a.es_profe_principal,
        }))
        .sort((a, b) => {
          if (a.es_principal !== b.es_principal) return a.es_principal ? -1 : 1
          return a.nombre_completo.localeCompare(b.nombre_completo)
        })
    }
  }

  return {
    header: {
      id: conv.id,
      nino_id: conv.nino_id,
      nino_nombre: conv.nino?.nombre ?? '',
      nino_apellidos: conv.nino?.apellidos ?? '',
      aula_nombre: matricula?.aula?.nombre ?? null,
      profes_aula,
    },
    mensajes: mensajesView,
    participo,
  }
}
