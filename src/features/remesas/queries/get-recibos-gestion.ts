import 'server-only'

import { createClient } from '@/lib/supabase/server'

import {
  ordenarGestion,
  entraEnGestion,
  ESTADOS_GESTION,
  type ReciboGestion,
} from '../lib/gestion-cobros'

export type { ReciboGestion } from '../lib/gestion-cobros'

/**
 * Recibos del periodo para la gestión de cobros y devoluciones, a grano FAMILIA: los que esperan
 * un cobro a mano (pendientes que no son SEPA: efectivo, transferencia, cheque, esporádicos y sin
 * método; PR-1a) y los que ya están en el ciclo de cobro (enviado_banco / devuelto /
 * cobrado_manual). Un SEPA pendiente no sale: va por remesa. RLS: Dirección del centro.
 */
export async function getRecibosGestion(
  centroId: string,
  anio: number,
  mes: number
): Promise<ReciboGestion[]> {
  const supabase = await createClient()

  const { data: recibos } = await supabase
    .from('recibos')
    .select(
      'id, familia_id, total_centimos, estado, metodo, es_esporadico, concepto_esporadico, fecha_envio_banco, fecha_devolucion, devuelto_de_recibo_id, cobro_forma, cobro_fecha, cobro_nota'
    )
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .in('estado', [...ESTADOS_GESTION])
    .is('deleted_at', null)

  const gestionables = (recibos ?? []).filter(entraEnGestion)
  if (gestionables.length === 0) return []

  const familiaIds = [
    ...new Set(gestionables.map((r) => r.familia_id).filter((x): x is string => x != null)),
  ]
  const { data: familias } = await supabase
    .from('familias')
    .select('id, etiqueta')
    .in('id', familiaIds)
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))

  return ordenarGestion(
    gestionables.map((r) => ({
      id: r.id,
      familiaEtiqueta: r.familia_id ? (etiquetaPorFamilia.get(r.familia_id) ?? '') : '',
      totalCentimos: r.total_centimos,
      estado: r.estado,
      metodo: r.metodo,
      esEsporadico: r.es_esporadico,
      conceptoEsporadico: r.concepto_esporadico,
      fechaEnvioBanco: r.fecha_envio_banco,
      fechaDevolucion: r.fecha_devolucion,
      esRegiro: r.devuelto_de_recibo_id != null,
      cobroForma: r.cobro_forma,
      cobroFecha: r.cobro_fecha,
      cobroNota: r.cobro_nota,
    }))
  )
}
