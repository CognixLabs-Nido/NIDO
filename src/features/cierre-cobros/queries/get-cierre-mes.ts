import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface CierreMesResumen {
  cerrado: boolean
  cerradoAt: string | null
  numRecibos: number
  totalCentimos: number
}

/**
 * Estado del cierre de un mes: si está cerrado (existe cierre_mensual) y un resumen de
 * los recibos REGULARES generados (nº + suma de totales). RLS: solo admin del centro.
 */
export async function getCierreMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<CierreMesResumen> {
  const supabase = await createClient()

  const { data: cierre } = await supabase
    .from('cierre_mensual')
    .select('cerrado_at')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()

  const { data: recibos } = await supabase
    .from('recibos')
    .select('total_centimos')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)

  const lista = recibos ?? []
  return {
    cerrado: cierre != null,
    cerradoAt: cierre?.cerrado_at ?? null,
    numRecibos: lista.length,
    totalCentimos: lista.reduce((acc, r) => acc + (r.total_centimos ?? 0), 0),
  }
}
