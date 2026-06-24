import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import type { AulaDestinoRollover, NinoActivoRollover } from '../lib/proponer'
import type { EstadoRollover, PendienteDestino } from '../types'

export async function getEstadoRollover(cursoDestinoId: string): Promise<EstadoRollover | null> {
  const supabase = await createClient()
  return getEstadoRolloverCore(supabase, cursoDestinoId)
}

/** Núcleo testeable (cliente inyectable). */
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
  if (destErr || !destino) {
    logger.warn('getEstadoRollover destino', destErr?.message)
    return null
  }

  // 2. Curso origen = el ACTIVO del mismo centro (de donde salen los niños).
  const { data: origen } = await supabase
    .from('cursos_academicos')
    .select('id, nombre')
    .eq('centro_id', destino.centro_id)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .maybeSingle()

  // 3. Aulas del curso destino (config copiada): tramo_edad + capacidad.
  const { data: aulasRaw } = await supabase
    .from('aulas_curso')
    .select('aula_id, tramo_edad, capacidad, aula:aulas!inner(nombre, deleted_at)')
    .eq('curso_academico_id', cursoDestinoId)

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
  let ninosActivos: NinoActivoRollover[] = []
  if (origen) {
    const { data: matRaw } = await supabase
      .from('matriculas')
      .select('nino:ninos!inner(id, nombre, apellidos, fecha_nacimiento, deleted_at)')
      .eq('curso_academico_id', origen.id)
      .eq('estado', 'activa')
      .is('fecha_baja', null)
      .is('deleted_at', null)

    ninosActivos = (
      (matRaw ?? []) as unknown as Array<{
        nino: {
          id: string
          nombre: string
          apellidos: string | null
          fecha_nacimiento: string | null
          deleted_at: string | null
        } | null
      }>
    )
      .filter((r) => r.nino && r.nino.deleted_at === null)
      .map((r) => ({
        nino_id: r.nino!.id,
        nombre: r.nino!.nombre,
        apellidos: r.nino!.apellidos,
        fecha_nacimiento: r.nino!.fecha_nacimiento,
      }))
  }

  // 5. Pendientes ya creadas en el destino (propuesta persistida → idempotencia).
  const { data: pendRaw } = await supabase
    .from('matriculas')
    .select('nino_id, aula_id')
    .eq('curso_academico_id', cursoDestinoId)
    .eq('estado', 'pendiente')
    .is('deleted_at', null)

  const pendientes = (pendRaw ?? []) as PendienteDestino[]

  return {
    cursoDestino: { id: destino.id, nombre: destino.nombre, estado: destino.estado },
    cursoOrigen: origen ? { id: origen.id, nombre: origen.nombre } : null,
    aulasDestino,
    ninosActivos,
    pendientes,
  }
}
