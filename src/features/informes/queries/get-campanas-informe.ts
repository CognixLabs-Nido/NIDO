import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { getCursoActivo } from '@/features/cursos/queries/get-cursos'

import { PERIODOS_INFORME, type CampanaInformeItem, type CampanasCursoActivo } from '../types'

/**
 * Campañas de informe del **curso activo** del centro (Q7), ordenadas por período.
 * Incluye abiertas y cerradas (la dirección consulta el histórico). La RLS
 * `campanas_informe_select` ya restringe al staff del centro; aquí solo se ordena.
 * Devuelve `null` si no hay curso activo (la UI muestra el aviso correspondiente).
 */
export async function getCampanasInformeCursoActivo(
  centroId: string
): Promise<CampanasCursoActivo | null> {
  const curso = await getCursoActivo(centroId)
  if (!curso) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('campanas_informe')
    .select('id, periodo, fecha_limite, estado, created_at, updated_at')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)

  const campanas = ((data ?? []) as CampanaInformeItem[]).sort(
    (a, b) => PERIODOS_INFORME.indexOf(a.periodo) - PERIODOS_INFORME.indexOf(b.periodo)
  )

  return { cursoId: curso.id, cursoNombre: curso.nombre, campanas }
}
