import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface BecaComedorMesItem {
  id: string
  /** Importe de la beca en EUROS (columna numeric; el motor la aplica en negativo). */
  importeEuros: number
}

/**
 * D-6-3: becas comedor del mes (centro + anio + mes), indexadas por `nino_id`. La RLS
 * admin-only (D-6-1) ya filtra por centro. `importe` es numeric (euros): PostgREST puede
 * devolverlo como string, así que se coacciona a number.
 */
export async function getBecasComedorMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<Record<string, BecaComedorMesItem>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('beca_comedor_mes')
    .select('id, nino_id, importe')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)

  const porNino: Record<string, BecaComedorMesItem> = {}
  for (const b of data ?? []) {
    porNino[b.nino_id] = { id: b.id, importeEuros: Number(b.importe) }
  }
  return porNino
}
