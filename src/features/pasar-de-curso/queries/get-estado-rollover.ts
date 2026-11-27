import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getAulaNombresPorIds } from '@/features/aulas/queries/get-aula-nombres'
import { createClient } from '@/lib/supabase/server'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'
import type { Database } from '@/types/db'

import type { AulaDestinoRollover, NinoActivoRollover } from '../lib/proponer'
import type { EstadoRollover, PendienteDestino } from '../types'

export async function getEstadoRollover(cursoDestinoId: string): Promise<EstadoRollover | null> {
  const supabase = await createClient()
  return getEstadoRolloverCore(supabase, cursoDestinoId)
}

/**
 * Núcleo testeable (cliente inyectable). `null`: el curso destino no existe. Una lectura que FALLA lanza
 * `LecturaFallida` (censo C, re-clasificación 168 y los F1/F2 de este fichero, 2026-11-26): antes el destino caído
 * era «Curso destino no encontrado», y las pendientes o los «Finaliza» caídos eran listas vacías con las que
 * `proponerMatriculas` y `confirmarRollover` decidían qué crear y si el curso estaba completo.
 */
export async function getEstadoRolloverCore(
  supabase: SupabaseClient<Database>,
  cursoDestinoId: string
): Promise<EstadoRollover | null> {
  // 1. Curso destino (debe existir; la UI solo lo lanza sobre planificados).
  const { data: destino, error: destErr } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, estado, centro_id')
    .eq('id', cursoDestinoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (destErr) throw new LecturaFallida('getEstadoRollover: curso destino', destErr)
  if (!destino) return null

  // 2. Curso origen = el ACTIVO del mismo centro (de donde salen los niños).
  const { data: origen, error: errOrigen } = await supabase
    .from('cursos_academicos')
    .select('id, nombre')
    .eq('centro_id', destino.centro_id)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .maybeSingle()
  if (errOrigen) throw new LecturaFallida('getEstadoRollover: curso origen', errOrigen)

  // 3. Aulas del curso destino (config copiada): tramo_edad + capacidad.
  const { data: aulasRaw, error: errAulas } = await supabase
    .from('aulas_curso')
    .select('aula_id, tramo_edad, capacidad, aula:aulas!inner(nombre, deleted_at)')
    .eq('curso_academico_id', cursoDestinoId)
  if (errAulas) throw new LecturaFallida('getEstadoRollover: aulas del destino', errAulas)

  const aulasDestino: AulaDestinoRollover[] = (
    (aulasRaw ?? []) as unknown as Array<{
      aula_id: string
      tramo_edad: number[]
      capacidad: number
      aula: { nombre: string; deleted_at: string | null } | null
    }>
  )
    .filter((r) => r.aula && r.aula.deleted_at === null)
    .map((r) => ({
      aula_id: r.aula_id,
      nombre: r.aula!.nombre,
      tramo_edad: r.tramo_edad,
      capacidad: r.capacidad,
    }))

  // 4. Niños con matrícula ACTIVA en el curso origen (los candidatos a subir).
  //    Se trae también el `aula_id` de origen: la matrícula ya no embebe `aulas`
  //    (FK compuesta a `aulas_curso`), así que el nombre se resuelve por id aparte.
  let ninosActivos: NinoActivoRollover[] = []
  if (origen) {
    const { data: matRaw, error: errMat } = await supabase
      .from('matriculas')
      .select('aula_id, nino:ninos!inner(id, nombre, apellidos, fecha_nacimiento, deleted_at)')
      .eq('curso_academico_id', origen.id)
      .eq('estado', 'activa')
      .is('fecha_baja', null)
      .is('deleted_at', null)
    if (errMat) throw new LecturaFallida('getEstadoRollover: niños activos', errMat)

    const filas = (
      (matRaw ?? []) as unknown as Array<{
        aula_id: string | null
        nino: {
          id: string
          nombre: string
          apellidos: string | null
          fecha_nacimiento: string | null
          deleted_at: string | null
        } | null
      }>
    ).filter((r) => r.nino && r.nino.deleted_at === null)

    const nombresAula = await getAulaNombresPorIds(
      supabase,
      filas.map((r) => r.aula_id)
    )

    ninosActivos = filas.map((r) => ({
      nino_id: r.nino!.id,
      nombre: r.nino!.nombre,
      apellidos: r.nino!.apellidos,
      fecha_nacimiento: r.nino!.fecha_nacimiento,
      aula_origen_id: r.aula_id,
      aula_origen_nombre: r.aula_id ? (nombresAula.get(r.aula_id) ?? null) : null,
    }))
  }

  // 5. Pendientes ya creadas en el destino (propuesta persistida → idempotencia).
  const { data: pendRaw, error: errPend } = await supabase
    .from('matriculas')
    .select('nino_id, aula_id')
    .eq('curso_academico_id', cursoDestinoId)
    .eq('estado', 'pendiente')
    .is('deleted_at', null)
  if (errPend) throw new LecturaFallida('getEstadoRollover: pendientes del destino', errPend)

  const pendientes = (pendRaw ?? []) as PendienteDestino[]

  // 6. F-3-A: niños marcados "Finaliza" en el destino (destino real, no ausencia de aula).
  const { data: finRaw, error: errFin } = await supabase
    .from('rollover_finaliza')
    .select('nino_id')
    .eq('curso_academico_id', cursoDestinoId)
  if (errFin) throw new LecturaFallida('getEstadoRollover: los que finalizan', errFin)
  const finalizados = (finRaw ?? []).map((r) => r.nino_id)

  return {
    cursoDestino: {
      id: destino.id,
      nombre: destino.nombre,
      estado: destino.estado,
      centroId: destino.centro_id,
    },
    cursoOrigen: origen ? { id: origen.id, nombre: origen.nombre } : null,
    aulasDestino,
    ninosActivos,
    pendientes,
    finalizados,
  }
}
