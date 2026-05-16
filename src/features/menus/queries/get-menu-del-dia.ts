import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { MenuDelDiaParaFamilia, MenuDiaRow } from '../types'

/**
 * Wrapper sobre el helper SQL `menu_del_dia(centro, fecha)`.
 * Devuelve el menú aplicable a la fecha consultando la plantilla
 * `publicada` del mes/año. NULL si no hay plantilla publicada o si la
 * plantilla no tiene fila para esa fecha.
 *
 * Se invoca como RPC. Como la función PG RETURNS public.menu_dia
 * (composite type), supabase-js entrega el row o null directamente.
 */
export async function getMenuDelDia(
  centroId: string,
  fecha: string
): Promise<MenuDelDiaParaFamilia | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('menu_del_dia', {
    p_centro_id: centroId,
    p_fecha: fecha,
  })

  if (error) {
    logger.warn('getMenuDelDia failed', error.message)
    return null
  }

  // PG composite type que puede llegar como objeto (PostgREST) o null.
  if (!data) return null
  const row = (Array.isArray(data) ? data[0] : data) as MenuDiaRow | null
  if (!row || !row.id) return null

  return {
    fecha: row.fecha,
    desayuno: row.desayuno,
    media_manana: row.media_manana,
    comida_primero: row.comida_primero,
    comida_segundo: row.comida_segundo,
    comida_postre: row.comida_postre,
    merienda: row.merienda,
  }
}
