import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { NinoAgendaResumen } from '../types'

interface MatriculaJoinNino {
  ninos: {
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
    foto_url: string | null
  } | null
}

/**
 * Lista los niños matriculados activos en un aula con un resumen rápido de su
 * agenda en `fecha`: id de la fila padre (si existe), counts por tipo de
 * evento y badges de alerta médica. Pensado para la vista profe del aula.
 */
export async function getAgendasAulaDelDia(
  aulaId: string,
  fecha: string
): Promise<NinoAgendaResumen[]> {
  const supabase = await createClient()

  // 1. Niños matriculados activos en el aula.
  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('ninos(id, nombre, apellidos, fecha_nacimiento, foto_url)')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const ninos = ((matriculas ?? []) as MatriculaJoinNino[])
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)

  if (ninos.length === 0) return []

  const ninoIds = ninos.map((n) => n.id)

  // 2. Cabeceras del día (sólo las que existen).
  const { data: cabeceras } = await supabase
    .from('agendas_diarias')
    .select('id, nino_id')
    .in('nino_id', ninoIds)
    .eq('fecha', fecha)

  const cabeceraByNino = new Map<string, string>((cabeceras ?? []).map((c) => [c.nino_id, c.id]))
  const agendaIds = Array.from(cabeceraByNino.values())

  // 3. Counts por agenda_id en las 4 tablas hijo.
  const counts = new Map<string, NinoAgendaResumen['counts']>()
  for (const id of agendaIds) {
    counts.set(id, { comidas: 0, biberones: 0, suenos: 0, deposiciones: 0 })
  }

  if (agendaIds.length > 0) {
    const [c, b, s, d] = await Promise.all([
      supabase.from('comidas').select('agenda_id').in('agenda_id', agendaIds),
      supabase.from('biberones').select('agenda_id').in('agenda_id', agendaIds),
      supabase.from('suenos').select('agenda_id').in('agenda_id', agendaIds),
      supabase.from('deposiciones').select('agenda_id').in('agenda_id', agendaIds),
    ])
    for (const row of c.data ?? []) {
      const k = (row as { agenda_id: string }).agenda_id
      const v = counts.get(k)
      if (v) v.comidas++
    }
    for (const row of b.data ?? []) {
      const k = (row as { agenda_id: string }).agenda_id
      const v = counts.get(k)
      if (v) v.biberones++
    }
    for (const row of s.data ?? []) {
      const k = (row as { agenda_id: string }).agenda_id
      const v = counts.get(k)
      if (v) v.suenos++
    }
    for (const row of d.data ?? []) {
      const k = (row as { agenda_id: string }).agenda_id
      const v = counts.get(k)
      if (v) v.deposiciones++
    }
  }

  // 4. Alertas médicas (alergias_graves no NULL, medicacion_habitual no vacío).
  //    `info_medica_emergencia.alergias_graves` está cifrada (BYTEA); para
  //    saber si "hay alergia grave" basta con que la columna no sea NULL,
  //    sin descifrar — eso ya nos dice si tiene un valor registrado.
  const { data: medicas } = await supabase
    .from('info_medica_emergencia')
    .select('nino_id, alergias_graves, medicacion_habitual')
    .in('nino_id', ninoIds)
    .is('deleted_at', null)

  const alertasByNino = new Map<string, NinoAgendaResumen['alertas']>()
  for (const row of (medicas ?? []) as Array<{
    nino_id: string
    alergias_graves: unknown
    medicacion_habitual: string | null
  }>) {
    alertasByNino.set(row.nino_id, {
      alergia_grave: row.alergias_graves !== null,
      medicacion: Boolean(row.medicacion_habitual && row.medicacion_habitual.trim().length > 0),
    })
  }

  // 5. Componer el resumen ordenado por nombre.
  return ninos
    .map((n) => ({
      nino: n,
      agenda_id: cabeceraByNino.get(n.id) ?? null,
      counts: cabeceraByNino.get(n.id)
        ? (counts.get(cabeceraByNino.get(n.id)!) ?? {
            comidas: 0,
            biberones: 0,
            suenos: 0,
            deposiciones: 0,
          })
        : { comidas: 0, biberones: 0, suenos: 0, deposiciones: 0 },
      alertas: alertasByNino.get(n.id) ?? { alergia_grave: false, medicacion: false },
    }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))
}
