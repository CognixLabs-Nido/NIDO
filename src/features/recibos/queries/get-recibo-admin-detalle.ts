import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { agruparLineasPorHijo, type DesgloseReciboFamilia } from '../lib/recibo-familia-detalle'
import { getHistorialRecibosFamilia, type ReciboHistorial } from './get-historial-recibos-familia'

export type ReciboAdminDetalleResult =
  | { ok: true; recibo: ReciboHistorial; desglose: DesgloseReciboFamilia }
  | { ok: false; motivo: 'no_encontrado' | 'error' }

/**
 * UN recibo de una familia para Dirección (F-6): la misma fila del histórico (estado y lo que pasó
 * al cobrarlo, con sus enlaces) y el desglose de líneas por hijo, también de un borrador. El recibo
 * tiene que ser de esa familia y de ese centro: si no, `no_encontrado`. RLS: Dirección del centro.
 */
export async function getReciboAdminDetalle(
  reciboId: string,
  familiaId: string,
  centroId: string
): Promise<ReciboAdminDetalleResult> {
  const historial = await getHistorialRecibosFamilia(familiaId, centroId)
  if (!historial.ok) return { ok: false, motivo: 'error' }
  const recibo = historial.recibos.find((r) => r.id === reciboId)
  if (!recibo) return { ok: false, motivo: 'no_encontrado' }

  const supabase = await createClient()
  const { data: lineas, error } = await supabase
    .from('lineas_recibo')
    .select('id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos')
    .eq('centro_id', centroId)
    .eq('recibo_id', reciboId)
    .order('created_at', { ascending: true })
  if (error) {
    logger.warn('getReciboAdminDetalle lineas', error.message)
    return { ok: false, motivo: 'error' }
  }

  const ninoIds = [
    ...new Set((lineas ?? []).map((l) => l.nino_id).filter((id): id is string => id != null)),
  ]
  const nombrePorNino = new Map<string, string>()
  if (ninoIds.length > 0) {
    const { data: ninos } = await supabase
      .from('ninos')
      .select('id, nombre, apellidos')
      .eq('centro_id', centroId)
      .in('id', ninoIds)
    for (const n of ninos ?? []) {
      nombrePorNino.set(n.id, [n.nombre, n.apellidos].filter(Boolean).join(' '))
    }
  }

  return {
    ok: true,
    recibo,
    desglose: agruparLineasPorHijo(
      (lineas ?? []).map((l) => ({
        id: l.id,
        ninoId: l.nino_id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioCentimos: l.precio_unitario_centimos,
        importeCentimos: l.importe_centimos,
      })),
      nombrePorNino
    ),
  }
}
