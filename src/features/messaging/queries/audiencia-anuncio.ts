import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * Audiencia teórica de un anuncio: lista de usuario_id que deberían recibir
 * el anuncio según su ámbito (aula o centro) y los flags vigentes en BD.
 *
 *  - Ámbito aula: profes activos del aula + tutores con
 *    `permisos.puede_recibir_mensajes=true` vinculados a niños matriculados
 *    activos en esa aula.
 *  - Ámbito centro: profes activos de cualquier aula del centro + tutores
 *    con permiso de cualquier niño matriculado activo en alguna aula del
 *    centro.
 *
 * "Teórica" porque refleja el estado en este momento. Si un tutor pierde
 * el flag entre la publicación y la consulta, sale del set; si lo gana,
 * entra. Para el caso de uso del autor (ver lectores) esto es lo deseado.
 *
 * Se usa por el contador "X de Y" (`getAnuncioDetalle`) y por la lista
 * detallada de lectores (`getLectoresAnuncio`).
 */
export async function audienciaAnuncio(
  supabase: SupabaseClient<Database>,
  anuncio: {
    centro_id: string
    ambito: 'aula' | 'centro'
    aula_id: string | null
  }
): Promise<Set<string>> {
  const audiencia = new Set<string>()

  if (anuncio.ambito === 'aula' && anuncio.aula_id) {
    const aulaId = anuncio.aula_id

    // Tutores con flag activo, vinculados a niños matriculados activos en el aula.
    const { data: tutores } = await supabase
      .from('vinculos_familiares')
      .select('usuario_id, nino:ninos!inner(matriculas(aula_id, fecha_baja, deleted_at))')
      .filter('permisos->puede_recibir_mensajes', 'eq', true)
      .is('deleted_at', null)

    for (const v of tutores ?? []) {
      const matriculas = v.nino?.matriculas ?? []
      for (const m of matriculas) {
        if (m.aula_id === aulaId && m.fecha_baja === null && m.deleted_at === null) {
          audiencia.add(v.usuario_id)
          break
        }
      }
    }

    // Profes activos del aula.
    const { data: profes } = await supabase
      .from('profes_aulas')
      .select('profe_id')
      .eq('aula_id', aulaId)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    for (const p of profes ?? []) audiencia.add(p.profe_id)
    return audiencia
  }

  if (anuncio.ambito === 'centro') {
    // Aulas activas del centro.
    const { data: aulasCentro } = await supabase
      .from('aulas')
      .select('id')
      .eq('centro_id', anuncio.centro_id)
      .is('deleted_at', null)
    const aulaIds = aulasCentro?.map((a) => a.id) ?? []

    if (aulaIds.length > 0) {
      const { data: profes } = await supabase
        .from('profes_aulas')
        .select('profe_id')
        .in('aula_id', aulaIds)
        .is('fecha_fin', null)
        .is('deleted_at', null)
      for (const p of profes ?? []) audiencia.add(p.profe_id)
    }

    const { data: tutores } = await supabase
      .from('vinculos_familiares')
      .select('usuario_id, nino:ninos!inner(matriculas(aula_id, fecha_baja, deleted_at))')
      .filter('permisos->puede_recibir_mensajes', 'eq', true)
      .is('deleted_at', null)

    const aulaSet = new Set(aulaIds)
    for (const v of tutores ?? []) {
      const matriculas = v.nino?.matriculas ?? []
      for (const m of matriculas) {
        if (m.fecha_baja === null && m.deleted_at === null && aulaSet.has(m.aula_id)) {
          audiencia.add(v.usuario_id)
          break
        }
      }
    }
    return audiencia
  }

  return audiencia
}
