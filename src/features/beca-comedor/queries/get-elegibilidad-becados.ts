import 'server-only'

import { getCursoActivo, type CursoListItem } from '@/features/cursos/queries/get-cursos'
import { createClient } from '@/lib/supabase/server'

export interface AlumnoElegibilidad {
  id: string
  nombre: string
  /** Elegibilidad ACTIVA en el curso activo (beca_comedor_elegibilidad.activa = true). */
  elegible: boolean
}

export interface ElegibilidadData {
  curso: CursoListItem | null
  alumnos: AlumnoElegibilidad[]
}

/**
 * V2-2 — alumnos con matrícula ACTIVA en el curso activo del centro + su elegibilidad de
 * beca comedor (activa/no). Sin selector de curso: siempre el vigente (`estado='activo'`).
 * Si no hay curso activo, devuelve `curso: null` (la UI muestra el aviso).
 */
export async function getElegibilidadBecados(centroId: string): Promise<ElegibilidadData> {
  const curso = await getCursoActivo(centroId)
  if (!curso) return { curso: null, alumnos: [] }

  const supabase = await createClient()

  // Alumnos con matrícula activa en el curso (dos pasos: matrículas → ninos, como get-ninos,
  // para no acoplarse a la cardinalidad del embebido).
  const { data: mats } = await supabase
    .from('matriculas')
    .select('nino_id')
    .eq('curso_academico_id', curso.id)
    .eq('estado', 'activa')
    .is('fecha_baja', null)
    .is('deleted_at', null)
  const ninoIds = [...new Set((mats ?? []).map((m) => m.nino_id))]
  if (ninoIds.length === 0) return { curso, alumnos: [] }

  const [{ data: ninos }, { data: elig }] = await Promise.all([
    supabase.from('ninos').select('id, nombre, apellidos').in('id', ninoIds).is('deleted_at', null),
    supabase
      .from('beca_comedor_elegibilidad')
      .select('nino_id, activa')
      .eq('curso_academico_id', curso.id)
      .in('nino_id', ninoIds),
  ])

  const elegibles = new Set((elig ?? []).filter((e) => e.activa).map((e) => e.nino_id))

  const alumnos: AlumnoElegibilidad[] = (ninos ?? [])
    .map((n) => ({
      id: n.id,
      nombre: [n.nombre, n.apellidos].filter(Boolean).join(' ').trim() || n.nombre,
      elegible: elegibles.has(n.id),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  return { curso, alumnos }
}
