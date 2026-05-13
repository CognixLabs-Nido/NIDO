import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface AulaListItem {
  id: string
  nombre: string
  cohorte_anos_nacimiento: number[]
  capacidad_maxima: number
  descripcion: string | null
}

export async function getAulasPorCurso(cursoAcademicoId: string): Promise<AulaListItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aulas')
    .select('id, nombre, cohorte_anos_nacimiento, capacidad_maxima, descripcion')
    .eq('curso_academico_id', cursoAcademicoId)
    .is('deleted_at', null)
    .order('nombre', { ascending: true })
  return (data ?? []) as AulaListItem[]
}

export async function getAulaById(aulaId: string): Promise<AulaListItem | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aulas')
    .select('id, nombre, cohorte_anos_nacimiento, capacidad_maxima, descripcion')
    .eq('id', aulaId)
    .is('deleted_at', null)
    .maybeSingle()
  return (data as AulaListItem | null) ?? null
}
