import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface CursoListItem {
  id: string
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  estado: 'planificado' | 'activo' | 'cerrado'
}

export async function getCursosPorCentro(centroId: string): Promise<CursoListItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_inicio, fecha_fin, estado')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('fecha_inicio', { ascending: false })
  return (data ?? []) as CursoListItem[]
}

export async function getCursoActivo(centroId: string): Promise<CursoListItem | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_inicio, fecha_fin, estado')
    .eq('centro_id', centroId)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .maybeSingle()
  return (data as CursoListItem | null) ?? null
}
