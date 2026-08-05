import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

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
  if (ninoIds.length > 0) {
    const { data: matriculas } = await supabase
      .from('matriculas')
      .select('nino_id, estado')
      .in('nino_id', ninoIds)
      .is('fecha_baja', null)
      .is('deleted_at', null)
    for (const m of matriculas ?? []) estadoPorNino.set(m.nino_id, m.estado)
  }

  return filas.map((f) => ({
    ...f,
    estado_matricula: f.nino_id ? (estadoPorNino.get(f.nino_id) ?? null) : null,
  }))
}
