import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { getAulasPorCursoCore, type AulaListItem } from './get-aulas'

/**
 * Aulas configuradas en el curso ACTIVO de un centro. Resuelve el curso activo
 * (`curso_activo_de_centro`) y reutiliza `getAulasPorCursoCore`. Devuelve `[]` si el
 * centro no tiene curso activo — el llamador debe distinguir "sin curso" de "sin aulas".
 *
 * Usada por el diálogo de reincorporación (F-3-F): el selector de aula obligatorio.
 */
export async function getAulasCursoActivo(centroId: string): Promise<AulaListItem[]> {
  const supabase = await createClient()
  const { data: cursoActivoId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: centroId,
  })
  if (!cursoActivoId) return []
  return getAulasPorCursoCore(supabase, cursoActivoId)
}
