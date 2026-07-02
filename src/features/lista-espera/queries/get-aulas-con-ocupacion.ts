import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { ESTADOS_QUE_OCUPAN, contarOcupacionAula, type AulaConOcupacion } from '../lib/ocupacion'

export type { AulaConOcupacion }

interface AulaCursoRow {
  aula_id: string
  capacidad: number
  aula: { nombre: string; deleted_at: string | null } | null
}

/**
 * Aulas (físicas) configuradas en un curso (`aulas_curso`) con su capacidad y su
 * ocupación actual, para el selector + aviso de capacidad al invitar desde Admisiones.
 *
 * Ocupación = matrículas ACTIVAS o PENDIENTES del aula en el curso (una fila por plaza:
 * la invitación enviada YA es una matrícula pendiente, no se suma aparte). Ver
 * `lib/ocupacion.ts`.
 */
export async function getAulasConOcupacion(cursoAcademicoId: string): Promise<AulaConOcupacion[]> {
  const supabase = await createClient()

  const { data: aulasCurso } = await supabase
    .from('aulas_curso')
    .select('aula_id, capacidad, aula:aulas!inner(nombre, deleted_at)')
    .eq('curso_academico_id', cursoAcademicoId)

  const aulasVivas = ((aulasCurso ?? []) as unknown as AulaCursoRow[]).filter(
    (a) => a.aula && a.aula.deleted_at === null
  )
  if (aulasVivas.length === 0) return []

  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('aula_id, estado')
    .eq('curso_academico_id', cursoAcademicoId)
    .is('deleted_at', null)
    .is('fecha_baja', null)
    .in('estado', ESTADOS_QUE_OCUPAN)

  const mats = matriculas ?? []

  return aulasVivas
    .map((a) => ({
      aulaId: a.aula_id,
      nombre: a.aula!.nombre,
      capacidad: a.capacidad,
      ocupacion: contarOcupacionAula(mats.filter((m) => m.aula_id === a.aula_id)),
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre))
}
