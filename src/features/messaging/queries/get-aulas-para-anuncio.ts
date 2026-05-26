import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface AulaParaAnuncio {
  id: string
  nombre: string
}

/**
 * Lista de aulas que el usuario puede usar como destino de un anuncio
 * ámbito='aula':
 *  - admin del centro: todas las aulas del centro,
 *  - profe: solo aulas donde tiene asignación activa.
 *
 * Pensado para el composer de anuncio (`/messages/nuevo-anuncio`).
 * La RLS de aulas SELECT ya filtra por `pertenece_a_centro`; el filtro
 * por asignación activa de profe se aplica en JS sobre la lista.
 */
export async function getAulasParaAnuncio(centroId: string): Promise<AulaParaAnuncio[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  // ¿Soy admin del centro?
  const { data: rolAdmin } = await supabase
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', userId)
    .eq('centro_id', centroId)
    .eq('rol', 'admin')
    .is('deleted_at', null)
    .maybeSingle()

  if (rolAdmin) {
    const { data: aulas, error } = await supabase
      .from('aulas')
      .select('id, nombre')
      .eq('centro_id', centroId)
      .is('deleted_at', null)
      .order('nombre', { ascending: true })
    if (error) {
      logger.warn('getAulasParaAnuncio: admin', error.message)
      return []
    }
    return aulas ?? []
  }

  // Profe: aulas con asignación activa
  const { data: asignaciones, error } = await supabase
    .from('profes_aulas')
    .select('aula:aulas!inner(id, nombre, centro_id, deleted_at)')
    .eq('profe_id', userId)
    .is('fecha_fin', null)
    .is('deleted_at', null)

  if (error) {
    logger.warn('getAulasParaAnuncio: profe', error.message)
    return []
  }

  const aulas: AulaParaAnuncio[] = []
  for (const a of asignaciones ?? []) {
    if (a.aula && a.aula.centro_id === centroId && a.aula.deleted_at === null) {
      aulas.push({ id: a.aula.id, nombre: a.aula.nombre })
    }
  }
  aulas.sort((x, y) => x.nombre.localeCompare(y.nombre))
  return aulas
}
