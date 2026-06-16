import 'server-only'

import { hoyMadridYmd } from '@/features/autorizaciones/lib/server-helpers'
import { createClient } from '@/lib/supabase/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'
import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'

import { consolidarAvisoCampana, type CampanaPendienteEntry } from '../lib/aviso-campana'
import type { CampanaPendientesAviso, PeriodoInforme } from '../types'

/** Solo coordinadora/profesora redactan informes (Q5); técnico/apoyo no. */
const REDACTORES = new Set(['coordinadora', 'profesora'])

interface ProfeAulaRow {
  aula_id: string
  tipo_personal_aula: string | null
}

interface MatriculaNinoRow {
  ninos: { id: string } | null
}

/**
 * Aviso consolidado de informes pendientes para el INICIO de la **profe redactora**
 * (F9-5-2). Derivado, sin tabla nueva (patrón #64): cuenta niños con matrícula
 * activa (Q3) de sus aulas de redacción SIN informe publicado para el (curso
 * activo, período) de cada **campaña abierta**.
 *
 * Devuelve `null` (sin aviso) si: no es redactora en ningún aula (técnico/apoyo o
 * admin), no hay campañas abiertas, o no le queda ningún informe pendiente. La
 * urgencia y la fecha mostrada salen de la campaña con pendientes más próxima (Q1).
 */
export async function getPendientesCampanaProfe(): Promise<CampanaPendientesAviso | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const centroId = await getCentroActualId()
  if (!centroId) return null
  const curso = await getCursoActivo(centroId)
  if (!curso) return null

  // 1. Campañas ABIERTAS del curso activo.
  const { data: campData } = await supabase
    .from('campanas_informe')
    .select('periodo, fecha_limite, estado')
    .eq('centro_id', centroId)
    .eq('curso_academico_id', curso.id)
    .eq('estado', 'abierta')
  const abiertas = (campData ?? []) as { periodo: PeriodoInforme; fecha_limite: string }[]
  if (abiertas.length === 0) return null

  // 2. Aulas de REDACCIÓN de la profe (coordinadora/profesora).
  const { data: paData } = await supabase
    .from('profes_aulas')
    .select('aula_id, tipo_personal_aula')
    .eq('profe_id', user.id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
  const aulaIds = ((paData ?? []) as ProfeAulaRow[])
    .filter((p) => REDACTORES.has(p.tipo_personal_aula ?? ''))
    .map((p) => p.aula_id)
  if (aulaIds.length === 0) return null

  // 3. Niños con matrícula activa en esas aulas (Q3: bajas excluidas).
  const { data: matData } = await aplicarMatriculaActiva(
    supabase.from('matriculas').select('ninos(id)').in('aula_id', aulaIds)
  )
  const ninoIds = ((matData ?? []) as MatriculaNinoRow[])
    .map((m) => m.ninos?.id)
    .filter((id): id is string => typeof id === 'string')
  if (ninoIds.length === 0) return null

  // 4. Informes publicados de la terna (curso, períodos abiertos) para esos niños.
  const periodos = abiertas.map((c) => c.periodo)
  const publicadosPorPeriodo = new Map<PeriodoInforme, Set<string>>()
  const { data: informes } = await supabase
    .from('informes_evolucion')
    .select('nino_id, periodo')
    .eq('curso_academico_id', curso.id)
    .eq('estado', 'publicado')
    .in('periodo', periodos)
    .in('nino_id', ninoIds)
  for (const row of informes ?? []) {
    const set = publicadosPorPeriodo.get(row.periodo) ?? new Set<string>()
    set.add(row.nino_id)
    publicadosPorPeriodo.set(row.periodo, set)
  }

  // 5. Pendientes por campaña = niños activos sin informe publicado de ese período.
  const entries: CampanaPendienteEntry[] = abiertas.map((c) => ({
    fechaLimite: c.fecha_limite,
    pendientes: ninoIds.length - (publicadosPorPeriodo.get(c.periodo)?.size ?? 0),
  }))

  return consolidarAvisoCampana(entries, hoyMadridYmd())
}
