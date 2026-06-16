import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/**
 * Resolutores de personas de **bajo nivel**, compartidos por las features que
 * necesitan materializar o difundir a grupos (recordatorios F6-C, agenda F7b).
 *
 * Son agnósticos del dominio: reciben el cliente (de servicio o de usuario) y
 * devuelven `usuario_id`s. No excluyen a nadie ni aplican reglas de negocio —
 * eso lo hace cada feature (p.ej. excluir al autor/organizador, dedup, etc.).
 *
 * Extraídos de `recordatorios/lib/audiencia.ts` (que ahora los consume) para
 * evitar duplicación; `profesDeAula` es nuevo (F7b: reunión de clase invita
 * también a las profes del aula).
 */

/** Niños con matrícula activa en un aula. */
export async function ninosActivosDeAula(client: Client, aulaId: string): Promise<string[]> {
  const { data } = await aplicarMatriculaActiva(
    client.from('matriculas').select('nino_id').eq('aula_id', aulaId)
  )
  return (data ?? []).map((m) => m.nino_id)
}

/** Todos los niños no borrados de un centro. */
export async function ninosDeCentro(client: Client, centroId: string): Promise<string[]> {
  const { data } = await client
    .from('ninos')
    .select('id')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  return (data ?? []).map((n) => n.id)
}

/**
 * Tutores/autorizados vinculados a cualquiera de los `ninoIds`.
 * Con `soloConFlag` filtra los que tienen `permisos.puede_recibir_mensajes=true`
 * (el flag JSONB se evalúa en JS, poco fiable con `eq`). Sin él, devuelve todos
 * los vínculos activos (invitación nominal dirigida, no broadcast).
 */
export async function tutoresDeNinos(
  client: Client,
  ninoIds: string[],
  opts: { soloConFlag: boolean }
): Promise<string[]> {
  if (ninoIds.length === 0) return []
  const { data } = await client
    .from('vinculos_familiares')
    .select('usuario_id, permisos')
    .in('nino_id', ninoIds)
    .is('deleted_at', null)
  const out = new Set<string>()
  for (const v of data ?? []) {
    if (opts.soloConFlag) {
      const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
      if (permisos.puede_recibir_mensajes !== true) continue
    }
    out.add(v.usuario_id)
  }
  return Array.from(out)
}

/** Usuarios con rol profe activo en el centro. */
export async function profesDeCentro(client: Client, centroId: string): Promise<string[]> {
  const { data } = await client
    .from('roles_usuario')
    .select('usuario_id')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)
  return (data ?? []).map((r) => r.usuario_id)
}

/** Profes con asignación activa a un aula (`profes_aulas`). Nuevo en F7b. */
export async function profesDeAula(client: Client, aulaId: string): Promise<string[]> {
  const { data } = await client
    .from('profes_aulas')
    .select('profe_id')
    .eq('aula_id', aulaId)
    .is('fecha_fin', null)
    .is('deleted_at', null)
  return (data ?? []).map((r) => r.profe_id)
}
