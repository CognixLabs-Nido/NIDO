import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { MotivoAusencia } from '../../ausencias/schemas/ausencia'
import type { AsistenciaRow, NinoAsistenciaResumen } from '../types'

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
 * Lista los niños matriculados activos en un aula con su asistencia para una
 * fecha (puede ser null si nadie ha pasado lista todavía, ADR-0015) y la
 * ausencia activa para esa fecha si existe (auto-link familia→profe).
 *
 * RLS filtra qué filas devuelve cada parte:
 * - matriculas/ninos: profe del aula o admin.
 * - asistencias: admin o profe del aula.
 * - ausencias: admin o profe del aula o tutor con permiso.
 */
export async function getPaseDeListaAula(
  aulaId: string,
  fecha: string
): Promise<NinoAsistenciaResumen[]> {
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

  // 2. Asistencias de hoy (LEFT JOIN lógico — pueden no existir).
  const { data: asistencias } = await supabase
    .from('asistencias')
    .select(
      'id, nino_id, fecha, estado, hora_llegada, hora_salida, observaciones, registrada_por, updated_at'
    )
    .in('nino_id', ninoIds)
    .eq('fecha', fecha)

  const asistenciaByNino = new Map<string, AsistenciaRow>(
    ((asistencias ?? []) as AsistenciaRow[]).map((a) => [a.nino_id, a])
  )

  // 3. Ausencias que cubren la fecha (rango inclusivo). Excluimos descripciones
  //    canceladas (prefijo `[cancelada] `) para que no contaminen el badge.
  const { data: ausencias } = await supabase
    .from('ausencias')
    .select('id, nino_id, motivo, descripcion, fecha_inicio, fecha_fin')
    .in('nino_id', ninoIds)
    .lte('fecha_inicio', fecha)
    .gte('fecha_fin', fecha)

  const ausenciaByNino = new Map<
    string,
    { id: string; motivo: MotivoAusencia; descripcion: string | null }
  >()
  for (const row of (ausencias ?? []) as Array<{
    id: string
    nino_id: string
    motivo: MotivoAusencia
    descripcion: string | null
  }>) {
    if (row.descripcion?.startsWith('[cancelada] ')) continue
    ausenciaByNino.set(row.nino_id, {
      id: row.id,
      motivo: row.motivo,
      descripcion: row.descripcion,
    })
  }

  // 4. Alertas médicas (idéntico patrón a la agenda).
  const { data: medicas } = await supabase
    .from('info_medica_emergencia')
    .select('nino_id, alergias_graves, medicacion_habitual')
    .in('nino_id', ninoIds)
    .is('deleted_at', null)

  const alertasByNino = new Map<string, NinoAsistenciaResumen['alertas']>()
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

  return ninos
    .map((n) => ({
      nino: n,
      asistencia: asistenciaByNino.get(n.id) ?? null,
      ausencia: ausenciaByNino.get(n.id) ?? null,
      alertas: alertasByNino.get(n.id) ?? { alergia_grave: false, medicacion: false },
    }))
    .sort((a, b) => a.nino.nombre.localeCompare(b.nino.nombre))
}
