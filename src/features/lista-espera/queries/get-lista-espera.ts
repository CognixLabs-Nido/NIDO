import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { altaEnProceso, type SenalMatricula } from '@/features/matriculas/lib/estado-alumno'

import type { EstadoMatricula } from '../lib/acciones-prospecto'

export interface ProspectoListItem {
  id: string
  nombre_nino: string
  apellidos_nino: string | null
  fecha_nacimiento: string | null
  telefono_tutor: string | null
  email_tutor: string | null
  nota: string | null
  posicion: number
  estado: Database['public']['Enums']['estado_lista_espera']
  /** U-2/D1: cuenta del tutor ya existente (2.º hijo). NULL = prospecto de familia nueva. */
  tutor_usuario_id: string | null
  /** U-4/D4: niño creado al promover este prospecto. NULL = sin promover. */
  nino_id: string | null
  /**
   * U-4/D4: estado de la matrícula ACTIVA de ese niño (`fecha_baja IS NULL`), o null si no hay
   * niño enlazado o no tiene matrícula activa. Alimenta el badge y las acciones de la fila.
   */
  estado_matricula: EstadoMatricula | null
}

/**
 * F11-H-3: prospectos de la lista de espera de un curso, ordenados por `posicion`.
 * Excluye los `descartado` (baja blanda). RLS limita a admin del centro.
 */
export async function getListaEspera(cursoAcademicoId: string): Promise<ProspectoListItem[]> {
  const supabase = await createClient()
  return getListaEsperaCore(supabase, cursoAcademicoId)
}

/** Núcleo testeable (cliente inyectable). */
export async function getListaEsperaCore(
  supabase: SupabaseClient<Database>,
  cursoAcademicoId: string
): Promise<ProspectoListItem[]> {
  const { data } = await supabase
    .from('lista_espera')
    .select(
      'id, nombre_nino, apellidos_nino, fecha_nacimiento, telefono_tutor, email_tutor, nota, posicion, estado, tutor_usuario_id, nino_id'
    )
    .eq('curso_academico_id', cursoAcademicoId)
    .neq('estado', 'descartado')
    .order('posicion', { ascending: true })

  const filas = (data ?? []) as Omit<ProspectoListItem, 'estado_matricula'>[]

  // U-4: el estado de matrícula se resuelve en UNA segunda lectura para todos los niños
  // enlazados, en vez de con un embed anidado de PostgREST: filtrar la matrícula ACTIVA
  // (`fecha_baja IS NULL AND deleted_at IS NULL`) dentro de un embed opcional es frágil, y así
  // el merge queda explícito y testeable. Va con el cliente del admin: la RLS de `matriculas`
  // ya lo autoriza por centro (sin policy nueva, sin service role).
  const ninoIds = filas.map((f) => f.nino_id).filter((id): id is string => id !== null)
  const estadoPorNino = new Map<string, EstadoMatricula>()
  const matriculasPorNino = new Map<string, SenalMatricula[]>()
  if (ninoIds.length > 0) {
    // Sin el filtro `fecha_baja IS NULL`: una matrícula de BAJA lo está (tiene fecha_baja) y
    // hay que verla para saber que el alta ya se resolvió. Con el filtro, un niño dado de
    // baja parecía "sin matrícula" y se quedaba en la lista como si siguiera en proceso.
    const { data: matriculas } = await supabase
      .from('matriculas')
      .select('nino_id, estado, activada_at, fecha_baja')
      .in('nino_id', ninoIds)
      .is('deleted_at', null)
    for (const m of matriculas ?? []) {
      const previas = matriculasPorNino.get(m.nino_id) ?? []
      previas.push({ estado: m.estado, activada_at: m.activada_at })
      matriculasPorNino.set(m.nino_id, previas)
      // El badge sigue saliendo de la matrícula VIGENTE, como hasta ahora.
      if (m.fecha_baja === null) estadoPorNino.set(m.nino_id, m.estado)
    }
  }

  return (
    filas
      // Admisiones es la bandeja de altas EN PROCESO. Un prospecto cuyo niño ya está
      // matriculado (o dado de baja) está resuelto: aquí ya no se actúa sobre él —la ficha
      // vive en Niños—. Se aplaza desde U-4 ("jubilar la fila de la lista es U-5"), pero U-5
      // acabó jubilando otra cosa (las puertas viejas de alta) y esto se quedó sin hacer.
      .filter((f) => altaEnProceso(f.nino_id ? (matriculasPorNino.get(f.nino_id) ?? []) : []))
      .map((f) => ({
        ...f,
        estado_matricula: f.nino_id ? (estadoPorNino.get(f.nino_id) ?? null) : null,
      }))
  )
}
