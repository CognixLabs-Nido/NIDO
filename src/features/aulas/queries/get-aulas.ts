import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export interface AulaListItem {
  id: string
  centro_id: string
  nombre: string
  cohorte_anos_nacimiento: number[]
  capacidad_maxima: number
  descripcion: string | null
}

/**
 * F11-H: el aula física vive en `aulas` y su configuración por curso (tramo de
 * edad + capacidad) en `aulas_curso`. La capa de aplicación sigue exponiendo
 * `AulaListItem` con los nombres operativos previos (`cohorte_anos_nacimiento`,
 * `capacidad_maxima`) mapeados desde `aulas_curso.tramo_edad` / `.capacidad`.
 */
interface AulaCursoJoinRow {
  aula_id: string
  tramo_edad: number[]
  capacidad: number
  aula: {
    centro_id: string
    nombre: string
    descripcion: string | null
    deleted_at: string | null
  } | null
}

function mapAulaCurso(row: AulaCursoJoinRow): AulaListItem | null {
  if (!row.aula || row.aula.deleted_at !== null) return null
  return {
    id: row.aula_id,
    centro_id: row.aula.centro_id,
    nombre: row.aula.nombre,
    cohorte_anos_nacimiento: row.tramo_edad,
    capacidad_maxima: row.capacidad,
    descripcion: row.aula.descripcion,
  }
}

const AULA_CURSO_SELECT =
  'aula_id, tramo_edad, capacidad, aula:aulas!inner(centro_id, nombre, descripcion, deleted_at)'

export async function getAulasPorCurso(cursoAcademicoId: string): Promise<AulaListItem[]> {
  const supabase = await createClient()
  return getAulasPorCursoCore(supabase, cursoAcademicoId)
}

/** Núcleo testeable (cliente inyectable). */
export async function getAulasPorCursoCore(
  supabase: SupabaseClient<Database>,
  cursoAcademicoId: string
): Promise<AulaListItem[]> {
  const { data } = await supabase
    .from('aulas_curso')
    .select(AULA_CURSO_SELECT)
    .eq('curso_academico_id', cursoAcademicoId)

  return ((data ?? []) as unknown as AulaCursoJoinRow[])
    .map(mapAulaCurso)
    .filter((a): a is AulaListItem => a !== null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/**
 * Aula (con su config) en el curso ACTIVO de su centro. Pensado para vistas
 * operativas (teacher) que solo conocen el id del aula física: resuelve el curso
 * activo internamente vía el JOIN con `cursos_academicos`.
 */
export async function getAulaById(aulaId: string): Promise<AulaListItem | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('aulas_curso')
    .select(
      'aula_id, tramo_edad, capacidad, aula:aulas!inner(centro_id, nombre, descripcion, deleted_at), curso:cursos_academicos!inner(estado, deleted_at)'
    )
    .eq('aula_id', aulaId)
    .eq('curso.estado', 'activo')
    .is('curso.deleted_at', null)
    .maybeSingle()

  if (!data) return null
  return mapAulaCurso(data as unknown as AulaCursoJoinRow)
}
