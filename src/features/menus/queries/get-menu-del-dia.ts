import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { MenuDelDia } from '../types'

/**
 * Wrapper sobre la función SQL `menu_del_dia(centro, fecha)`. Devuelve los
 * 4 momentos del día (cualquiera puede ser null si la plantilla no los
 * ha definido), o null si:
 *  - es sábado/domingo,
 *  - no hay plantilla publicada vigente,
 *  - la plantilla no cubre el día de la semana.
 */
export async function getMenuDelDia(centroId: string, fecha: string): Promise<MenuDelDia | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('menu_del_dia', {
    p_centro_id: centroId,
    p_fecha: fecha,
  })
  if (error || !data || data.length === 0) return null
  const row = data[0] as MenuDelDia
  return {
    desayuno: row.desayuno ?? null,
    media_manana: row.media_manana ?? null,
    comida: row.comida ?? null,
    merienda: row.merienda ?? null,
  }
}
