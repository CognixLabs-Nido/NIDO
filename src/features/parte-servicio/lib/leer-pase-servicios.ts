import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { combinarPase, type FilaPase, type ParteDia } from './pase-servicios'

type Client = SupabaseClient<Database>

/** Ids por petición: un `.in()` largo no cabe en la URL de PostgREST. */
const LOTE = 150

/**
 * PR-12 — el listado único de un día: los niños del centro (nombre y clase, por
 * `listado_pase_servicios`, que no abre a la profe la ficha de los niños de otras aulas) con lo
 * ya apuntado en `parte_servicio_diario` (RLS: Dirección o cualquier profe del centro). Recibe el
 * cliente: la página pasa el de la sesión y el test de RLS el suyo. Un error se lanza.
 */
export async function leerPaseServicios(
  supabase: Client,
  centroId: string,
  fecha: string
): Promise<FilaPase[]> {
  const { data: listado, error } = await supabase.rpc('listado_pase_servicios', {
    p_centro_id: centroId,
  })
  if (error) throw new Error(`leerPaseServicios listado: ${error.code ?? ''} ${error.message}`)
  const alumnos = listado ?? []

  const partes: ParteDia[] = []
  const ids = alumnos.map((a) => a.nino_id)
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error: e } = await supabase
      .from('parte_servicio_diario')
      .select('nino_id, servicio, presente')
      .eq('centro_id', centroId)
      .eq('fecha', fecha)
      .in('nino_id', ids.slice(i, i + LOTE))
    if (e) throw new Error(`leerPaseServicios partes: ${e.code ?? ''} ${e.message}`)
    partes.push(...(data ?? []))
  }

  return combinarPase(alumnos, partes)
}
