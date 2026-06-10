import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { getCursoActivo } from '@/features/cursos/queries/get-cursos'

import { parseEstructura, parseRespuestas } from '../lib/estructura'
import {
  PERIODOS_INFORME,
  type AulaInformes,
  type InformeEvolucionDetalle,
  type InformePeriodoEstado,
  type NinoInformes,
  type PeriodoInforme,
} from '../types'

const REDACTORES = new Set(['coordinadora', 'profesora'])

interface ProfeAulaRow {
  aula_id: string
  tipo_personal_aula: string | null
  aulas: { id: string; nombre: string } | null
}

interface MatriculaNinoRow {
  aula_id: string
  ninos: { id: string; nombre: string; apellidos: string } | null
}

function porPeriodoVacio(): Record<PeriodoInforme, InformePeriodoEstado> {
  const out = {} as Record<PeriodoInforme, InformePeriodoEstado>
  for (const p of PERIODOS_INFORME) out[p] = { id: null, estado: null }
  return out
}

/**
 * Aulas del profe (vía `profes_aulas` activas) con sus niños matriculados y el
 * estado del informe de cada niño por período (curso activo). `puedeRedactar` por
 * aula = el profe es coordinadora/profesora (Q5; tecnico/apoyo solo leen). La RLS
 * filtra qué filas devuelve cada tabla; aquí solo se ordenan y agrupan.
 */
export async function getInformesDeMisAulas(): Promise<AulaInformes[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const centroId = await getCentroActualId()
  if (!centroId) return []
  const curso = await getCursoActivo(centroId)
  if (!curso) return []

  // 1. Aulas activas del profe + su tipo de personal.
  const { data: pa } = await supabase
    .from('profes_aulas')
    .select('aula_id, tipo_personal_aula, aulas(id, nombre)')
    .eq('profe_id', user.id)
    .is('fecha_fin', null)
    .is('deleted_at', null)

  const aulas = (pa ?? []) as ProfeAulaRow[]
  if (aulas.length === 0) return []

  const aulaIds = aulas.map((a) => a.aula_id)

  // 2. Niños matriculados activos en esas aulas.
  const { data: mat } = await supabase
    .from('matriculas')
    .select('aula_id, ninos(id, nombre, apellidos)')
    .in('aula_id', aulaIds)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const matriculas = (mat ?? []) as MatriculaNinoRow[]
  const ninoIds = matriculas
    .map((m) => m.ninos?.id)
    .filter((id): id is string => typeof id === 'string')

  // 3. Informes existentes de esos niños en el curso activo.
  const informesByNino = new Map<string, Map<PeriodoInforme, InformePeriodoEstado>>()
  if (ninoIds.length > 0) {
    const { data: informes } = await supabase
      .from('informes_evolucion')
      .select('id, nino_id, periodo, estado')
      .eq('curso_academico_id', curso.id)
      .in('nino_id', ninoIds)
    for (const row of informes ?? []) {
      let m = informesByNino.get(row.nino_id)
      if (!m) {
        m = new Map()
        informesByNino.set(row.nino_id, m)
      }
      m.set(row.periodo, { id: row.id, estado: row.estado })
    }
  }

  // 4. Agrupa niños por aula.
  const ninosByAula = new Map<string, NinoInformes[]>()
  for (const m of matriculas) {
    if (!m.ninos) continue
    const porPeriodo = porPeriodoVacio()
    const existentes = informesByNino.get(m.ninos.id)
    if (existentes) {
      for (const [periodo, estado] of existentes) porPeriodo[periodo] = estado
    }
    const lista = ninosByAula.get(m.aula_id) ?? []
    lista.push({
      id: m.ninos.id,
      nombre: m.ninos.nombre,
      apellidos: m.ninos.apellidos,
      porPeriodo,
    })
    ninosByAula.set(m.aula_id, lista)
  }

  return aulas
    .filter((a) => a.aulas)
    .map((a) => ({
      id: a.aulas!.id,
      nombre: a.aulas!.nombre,
      puedeRedactar: REDACTORES.has(a.tipo_personal_aula ?? ''),
      ninos: (ninosByAula.get(a.aula_id) ?? []).sort((x, y) => x.nombre.localeCompare(y.nombre)),
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre))
}

interface InformeDetalleRow {
  id: string
  nino_id: string
  periodo: PeriodoInforme
  estado: 'borrador' | 'publicado'
  estructura_snapshot: unknown
  respuestas: unknown
  observaciones_generales: string | null
  publicado_at: string | null
  notificado_at: string | null
  ninos: { nombre: string; apellidos: string } | null
}

/**
 * Detalle de un informe para rellenar/leer. La RLS `informes_evolucion_select`
 * gobierna el acceso (staff del aula del niño; la familia solo publicados, F9-3).
 * `puedeRedactar` (coordinadora/profesora o admin) vía el helper `es_redactor_de_nino`.
 */
export async function getInformeEvolucionDetalle(
  id: string
): Promise<InformeEvolucionDetalle | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('informes_evolucion')
    .select(
      'id, nino_id, periodo, estado, estructura_snapshot, respuestas, observaciones_generales, publicado_at, notificado_at, ninos(nombre, apellidos)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as InformeDetalleRow

  const { data: puede } = await supabase.rpc('es_redactor_de_nino', { p_nino_id: row.nino_id })

  return {
    id: row.id,
    nino_id: row.nino_id,
    nino_nombre: row.ninos ? `${row.ninos.nombre} ${row.ninos.apellidos}` : '',
    periodo: row.periodo,
    estado: row.estado,
    estructura_snapshot: parseEstructura(row.estructura_snapshot as never),
    respuestas: parseRespuestas(row.respuestas as never),
    observaciones_generales: row.observaciones_generales,
    publicado_at: row.publicado_at,
    notificado_at: row.notificado_at,
    puedeRedactar: puede === true,
  }
}
