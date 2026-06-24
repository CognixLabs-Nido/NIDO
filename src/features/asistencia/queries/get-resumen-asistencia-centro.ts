import 'server-only'

import { esMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'

import type { ResumenAulaCount } from '../types'

/**
 * Resumen rápido por aula para la card "Asistencia hoy" del admin: total de
 * niños matriculados, presentes y ausentes a fecha dada. RLS filtra a las
 * aulas del centro del admin actual.
 */
export async function getResumenAsistenciaCentro(fecha: string): Promise<ResumenAulaCount[]> {
  const supabase = await createClient()

  // F11-H: matriculas ya no tiene FK directa a aulas (es compuesta a aulas_curso),
  // así que no se puede anidar `aulas(matriculas(...))`. Se leen por separado y se
  // agrupan por aula_id. RLS filtra ambas a las aulas/matrículas del centro.
  const { data: aulas } = await supabase.from('aulas').select('id, nombre').is('deleted_at', null)

  const aulasRows = (aulas ?? []) as Array<{ id: string; nombre: string }>

  const aulaIds = aulasRows.map((a) => a.id)
  const { data: matriculas } = aulaIds.length
    ? await supabase
        .from('matriculas')
        .select('aula_id, nino_id, fecha_baja, deleted_at, estado')
        .in('aula_id', aulaIds)
    : { data: [] }

  const matriculasRows = (matriculas ?? []) as Array<{
    aula_id: string
    nino_id: string
    fecha_baja: string | null
    deleted_at: string | null
    estado: string | null
  }>

  // Recolectar todos los nino_id activos por aula.
  const ninosByAula = new Map<string, string[]>()
  for (const a of aulasRows) ninosByAula.set(a.id, [])
  for (const m of matriculasRows) {
    if (!esMatriculaActiva(m)) continue
    ninosByAula.get(m.aula_id)?.push(m.nino_id)
  }

  const todosNinoIds = Array.from(new Set(aulasRows.flatMap((a) => ninosByAula.get(a.id) ?? [])))
  if (todosNinoIds.length === 0) {
    return aulasRows.map((a) => ({
      aula_id: a.id,
      aula_nombre: a.nombre,
      presentes: 0,
      ausentes: 0,
      total: 0,
    }))
  }

  const { data: asistencias } = await supabase
    .from('asistencias')
    .select('nino_id, estado')
    .in('nino_id', todosNinoIds)
    .eq('fecha', fecha)

  const estadoByNino = new Map<string, string>(
    ((asistencias ?? []) as Array<{ nino_id: string; estado: string }>).map((r) => [
      r.nino_id,
      r.estado,
    ])
  )

  return aulasRows
    .map((a) => {
      const ninos = ninosByAula.get(a.id) ?? []
      let presentes = 0
      let ausentes = 0
      for (const id of ninos) {
        const e = estadoByNino.get(id)
        if (e === 'presente' || e === 'llegada_tarde' || e === 'salida_temprana') presentes++
        else if (e === 'ausente') ausentes++
      }
      return {
        aula_id: a.id,
        aula_nombre: a.nombre,
        presentes,
        ausentes,
        total: ninos.length,
      }
    })
    .sort((a, b) => a.aula_nombre.localeCompare(b.aula_nombre))
}
