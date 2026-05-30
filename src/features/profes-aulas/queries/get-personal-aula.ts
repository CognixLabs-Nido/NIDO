import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { TIPO_PERSONAL_AULA_ORDER, type TipoPersonalAula } from '../types'

/**
 * Personal ACTIVO de un aula con el `id` de la asignación, que el
 * `GestionarPersonalDialog` necesita para terminar / cambiar tipo / mover.
 *
 * A diferencia de `getAulasConPersonal` (que sirve los badges de la tabla y
 * NO expone el `profes_aulas.id`), esta query devuelve la fila completa
 * mínima para operar. Orden: coordinadora primero (TIPO_PERSONAL_AULA_ORDER),
 * luego alfabético.
 */
export interface PersonalAulaItem {
  asignacion_id: string
  profe_id: string
  nombre_completo: string
  tipo_personal_aula: TipoPersonalAula
}

export async function getPersonalAula(aulaId: string): Promise<PersonalAulaItem[]> {
  const supabase = await createClient()
  return getPersonalAulaCore(supabase, aulaId)
}

/** Núcleo testeable (cliente inyectable). */
export async function getPersonalAulaCore(
  supabase: SupabaseClient<Database>,
  aulaId: string
): Promise<PersonalAulaItem[]> {
  const { data, error } = await supabase
    .from('profes_aulas')
    .select('id, profe_id, tipo_personal_aula, profe:usuarios!inner(id, nombre_completo)')
    .eq('aula_id', aulaId)
    .is('fecha_fin', null)
    .is('deleted_at', null)

  if (error) {
    logger.warn('getPersonalAula error', error.message)
    return []
  }

  const items: PersonalAulaItem[] = []
  for (const row of data ?? []) {
    if (!row.profe) continue
    items.push({
      asignacion_id: row.id,
      profe_id: row.profe_id,
      nombre_completo: row.profe.nombre_completo,
      tipo_personal_aula: row.tipo_personal_aula,
    })
  }

  return items.sort((a, b) => {
    const peso =
      TIPO_PERSONAL_AULA_ORDER[a.tipo_personal_aula] -
      TIPO_PERSONAL_AULA_ORDER[b.tipo_personal_aula]
    if (peso !== 0) return peso
    return a.nombre_completo.localeCompare(b.nombre_completo)
  })
}
