import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { MenuDiaRow, PlantillaConMenus, PlantillaMenuRow } from '../types'

/**
 * Devuelve la plantilla + todas sus filas `menu_dia` (ordenadas por
 * fecha). Devuelve null si la plantilla no existe o RLS la bloquea.
 */
export async function getPlantillaMes(plantillaId: string): Promise<PlantillaConMenus | null> {
  const supabase = await createClient()

  const { data: plantilla, error: pErr } = await supabase
    .from('plantillas_menu_mensual')
    .select('*')
    .eq('id', plantillaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (pErr) {
    logger.warn('getPlantillaMes plantilla failed', pErr.message)
    return null
  }
  if (!plantilla) return null

  const { data: menus, error: mErr } = await supabase
    .from('menu_dia')
    .select('*')
    .eq('plantilla_id', plantillaId)
    .order('fecha', { ascending: true })

  if (mErr) {
    logger.warn('getPlantillaMes menus failed', mErr.message)
    return { plantilla: plantilla as PlantillaMenuRow, menus: [] }
  }

  return { plantilla: plantilla as PlantillaMenuRow, menus: (menus ?? []) as MenuDiaRow[] }
}
