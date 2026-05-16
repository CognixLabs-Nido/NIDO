import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { PlantillaMenuRow } from '../types'

/**
 * Devuelve la lista de plantillas del centro ordenadas por (anio DESC,
 * mes DESC). Soft-deleted excluidas. RLS filtra automáticamente por
 * `pertenece_a_centro` — admin/profe/tutor del centro las ven.
 */
export async function getPlantillasCentro(centroId: string): Promise<PlantillaMenuRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantillas_menu_mensual')
    .select('*')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(50)

  if (error) {
    logger.warn('getPlantillasCentro failed', error.message)
    return []
  }
  return data ?? []
}
