import 'server-only'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
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
 *
 * Si alguna de las cuatro lecturas falla, LANZA: sin ellas no hay pase de lista que ofrecer (la
 * página lo dice). Una lista vacía, una fila en blanco o una fila sin el aviso de ausencia no son
 * lo mismo que «no se pudo leer».
 */
export async function getPaseDeListaAula(
  aulaId: string,
  fecha: string
): Promise<NinoAsistenciaResumen[]> {
  const supabase = await createClient()

  // 1. Niños matriculados activos en el aula.
  const { data: matriculas, error: errorMatriculas } = await aplicarMatriculaActiva(
    supabase
      .from('matriculas')
      .select('ninos(id, nombre, apellidos, fecha_nacimiento, foto_url)')
      .eq('aula_id', aulaId)
  )

  if (errorMatriculas) throw new Error(`matrículas del aula: ${errorMatriculas.message}`)

  const ninos = ((matriculas ?? []) as MatriculaJoinNino[])
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)

  if (ninos.length === 0) return []

  const ninoIds = ninos.map((n) => n.id)

  // 2. Asistencias de hoy (LEFT JOIN lógico — pueden no existir).
  const { data: asistencias, error: errorAsistencias } = await supabase
    .from('asistencias')
    .select(
      'id, nino_id, fecha, estado, hora_llegada, observaciones, registrada_por, updated_at'
    )
    .in('nino_id', ninoIds)
    .eq('fecha', fecha)

  // Sin las asistencias de hoy, cada fila saldría en blanco y guardarla pisaría lo apuntado
  // (2026-11-12, medido): un fallo no es «nadie ha pasado lista todavía».
  if (errorAsistencias) throw new Error(`asistencias: ${errorAsistencias.message}`)

  const asistenciaByNino = new Map<string, AsistenciaRow>(
    ((asistencias ?? []) as AsistenciaRow[]).map((a) => [a.nino_id, a])
  )

  // 3. Ausencias que cubren la fecha (rango inclusivo). Excluimos descripciones
  //    canceladas (prefijo `[cancelada] `) para que no contaminen el badge.
  const { data: ausencias, error: errorAusencias } = await supabase
    .from('ausencias')
    .select('id, nino_id, motivo, descripcion, fecha_inicio, fecha_fin')
    .in('nino_id', ninoIds)
    .lte('fecha_inicio', fecha)
    .gte('fecha_fin', fecha)

  // Sin las ausencias, el niño cuya familia avisó de que no viene saldría sin el aviso y se
  // podría marcar presente: el registro de quién está dentro del centro. Media lista no se pasa.
  if (errorAusencias) throw new Error(`ausencias: ${errorAusencias.message}`)

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
  const { data: medicas, error: errorMedicas } = await supabase.rpc('alertas_medicas', {
    p_nino_ids: ninoIds,
  })
  // Un fallo aquí no puede pintarse como «sin alergia»: sin las alertas, la lista no sale.
  if (errorMedicas) throw new Error(`alertas médicas: ${errorMedicas.message}`)

  const alertasByNino = new Map<string, NinoAsistenciaResumen['alertas']>()
  for (const row of medicas ?? []) {
    alertasByNino.set(row.nino_id, {
      alergia_grave: row.alergia_grave,
      medicacion: row.medicacion,
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
