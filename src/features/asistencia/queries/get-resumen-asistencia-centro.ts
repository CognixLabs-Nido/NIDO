import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { ResumenAulaCount } from '../types'

/**
 * Resumen rápido por aula para la card "Asistencia hoy" del admin: total de
 * niños matriculados, presentes y ausentes a fecha dada. RLS filtra a las
 * aulas del centro del admin actual.
 */
export async function getResumenAsistenciaCentro(fecha: string): Promise<ResumenAulaCount[]> {
  const supabase = await createClient()

  const { data: aulas } = await supabase
    .from('aulas')
    .select('id, nombre, matriculas(nino_id, fecha_baja, deleted_at)')
    .is('deleted_at', null)

  const aulasRows = (aulas ?? []) as Array<{
    id: string
    nombre: string
    matriculas: Array<{ nino_id: string; fecha_baja: string | null; deleted_at: string | null }>
  }>

  // Recolectar todos los nino_id activos.
  const ninosByAula = new Map<string, string[]>()
  for (const a of aulasRows) {
    const activos = a.matriculas
      .filter((m) => m.fecha_baja === null && m.deleted_at === null)
      .map((m) => m.nino_id)
    ninosByAula.set(a.id, activos)
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
