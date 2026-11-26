import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'

export interface CursoListItem {
  id: string
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  estado: 'planificado' | 'activo' | 'cerrado'
}

export async function getCursosPorCentro(centroId: string): Promise<CursoListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_inicio, fecha_fin, estado')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('fecha_inicio', { ascending: false })
  if (error) throw new LecturaFallida('getCursosPorCentro', error)
  return (data ?? []) as CursoListItem[]
}

export async function getCursoActivo(centroId: string): Promise<CursoListItem | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_inicio, fecha_fin, estado')
    .eq('centro_id', centroId)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .maybeSingle()
  // Censo C (2026-11-26): una lectura caída era «el centro no tiene curso activo».
  if (error) throw new LecturaFallida('getCursoActivo', error)
  return (data as CursoListItem | null) ?? null
}

/** Cursos planificados (candidatos a destino del "pasar de curso"), por fecha. */
export async function getCursosPlanificados(centroId: string): Promise<CursoListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_inicio, fecha_fin, estado')
    .eq('centro_id', centroId)
    .eq('estado', 'planificado')
    .is('deleted_at', null)
    .order('fecha_inicio', { ascending: true })
  if (error) throw new LecturaFallida('getCursosPlanificados', error)
  return (data ?? []) as CursoListItem[]
}
