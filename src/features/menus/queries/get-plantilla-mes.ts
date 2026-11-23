import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { MenuDiaRow, PlantillaConMenus, PlantillaMenuRow } from '../types'

/**
 * Devuelve la plantilla + todas sus filas `menu_dia` (ordenadas por
 * fecha). Devuelve null si la plantilla no existe o RLS la bloquea; si una lectura falla, lanza.
 */
export async function getPlantillaMes(plantillaId: string): Promise<PlantillaConMenus | null> {
  const supabase = await createClient()

  const { data: plantilla, error: pErr } = await supabase
    .from('plantillas_menu_mensual')
    .select('*')
    .eq('id', plantillaId)
    .is('deleted_at', null)
    .maybeSingle()

  // C, 2026-11-23: un fallo no es «no existe» (la página daría 404) ni un mes vacío (el editor
  // guardaría cada día tocado sobre lo que no se leyó): se lanza.
  if (pErr) throw new Error(`menú del mes, plantilla: ${pErr.message}`)
  if (!plantilla) return null

  const { data: menus, error: mErr } = await supabase
    .from('menu_dia')
    .select('*')
    .eq('plantilla_id', plantillaId)
    .order('fecha', { ascending: true })

  if (mErr) throw new Error(`menú del mes, días: ${mErr.message}`)

  return { plantilla: plantilla as PlantillaMenuRow, menus: (menus ?? []) as MenuDiaRow[] }
}
