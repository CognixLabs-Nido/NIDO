import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Nombres de los centros dados (para el selector y el conmutador de centro). La RLS
 * (`centros_select_miembros`) solo devuelve los centros a los que el usuario pertenece.
 */
export async function getNombresCentros(
  centroIds: readonly string[]
): Promise<Map<string, string>> {
  if (centroIds.length === 0) return new Map()
  const supabase = await createClient()
  const { data } = await supabase
    .from('centros')
    .select('id, nombre')
    .in('id', [...centroIds])
    .is('deleted_at', null)
  return new Map((data ?? []).map((c) => [c.id, c.nombre]))
}
