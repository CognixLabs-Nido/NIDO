import 'server-only'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'

import { derivarSeguimiento, type AulaSeed, type MatriculaSeed } from '../lib/seguimiento'
import type { PeriodoInforme, SeguimientoAula } from '../types'

interface MatriculaNinoRow {
  aula_id: string
  ninos: { id: string; nombre: string; apellidos: string } | null
}

/**
 * Progreso por aula de la campaña (curso, período) del centro: publicados vs
 * pendientes. **Consulta derivada** (sin tabla de seguimiento): una pasada por las
 * aulas del curso + sus matrículas activas + los informes publicados de la terna.
 * La RLS de cada tabla filtra qué ve la dirección; aquí solo se agrega en memoria.
 *
 * Evita N+1: un único `in('nino_id', …)` para los informes. `informes_evolucion`
 * no tiene `aula_id`; el aula de cada niño sale de su matrícula activa (UNIQUE por
 * niño+curso, así que cada niño cuenta en una sola aula).
 */
export async function getSeguimientoCampana(
  cursoId: string,
  periodo: PeriodoInforme
): Promise<SeguimientoAula[]> {
  const supabase = await createClient()

  // 1. Aulas del curso (F11-H: la pertenencia aula↔curso vive en aulas_curso).
  const { data: aulasData } = await supabase
    .from('aulas_curso')
    .select('aula_id, aula:aulas!inner(nombre, deleted_at)')
    .eq('curso_academico_id', cursoId)

  const aulas = (
    (aulasData ?? []) as unknown as Array<{
      aula_id: string
      aula: { nombre: string; deleted_at: string | null } | null
    }>
  )
    .filter((r) => r.aula && r.aula.deleted_at === null)
    .map((r) => ({ id: r.aula_id, nombre: r.aula!.nombre }) satisfies AulaSeed)
  if (aulas.length === 0) return []
  const aulaIds = aulas.map((a) => a.id)

  // 2. Matrículas activas (bajas excluidas; Q3) con el niño.
  const { data: matData } = await aplicarMatriculaActiva(
    supabase
      .from('matriculas')
      .select('aula_id, ninos(id, nombre, apellidos)')
      .in('aula_id', aulaIds)
  )

  const matriculas: MatriculaSeed[] = ((matData ?? []) as MatriculaNinoRow[])
    .filter((m): m is MatriculaNinoRow & { ninos: NonNullable<MatriculaNinoRow['ninos']> } =>
      Boolean(m.ninos)
    )
    .map((m) => ({ aula_id: m.aula_id, nino: m.ninos }))

  const ninoIds = matriculas.map((m) => m.nino.id)

  // 3. Informes publicados de la terna (curso, período) para esos niños.
  const publicados = new Set<string>()
  if (ninoIds.length > 0) {
    const { data: informes } = await supabase
      .from('informes_evolucion')
      .select('nino_id')
      .eq('curso_academico_id', cursoId)
      .eq('periodo', periodo)
      .eq('estado', 'publicado')
      .in('nino_id', ninoIds)
    for (const row of informes ?? []) publicados.add(row.nino_id)
  }

  return derivarSeguimiento(aulas, matriculas, publicados)
}
