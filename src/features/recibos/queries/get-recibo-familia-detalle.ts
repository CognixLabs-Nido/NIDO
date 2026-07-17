import 'server-only'

import {
  agruparLineasPorHijo,
  type DesgloseReciboFamilia,
  type LineaConNino,
} from '@/features/recibos/lib/recibo-familia-detalle'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ReciboFamiliaDetalle {
  id: string
  anio: number
  mes: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
  esEsporadico: boolean
  conceptoEsporadico: string | null
  esRegiro: boolean
  fechaEnvioBanco: string | null
  fechaDevolucion: string | null
  /** Líneas repartidas por hijo + bloque familiar (descuento hermanos, saldo, cargo familia). */
  desglose: DesgloseReciboFamilia
}

/**
 * Detalle de UN recibo FAMILIAR del tutor legal con su desglose de líneas agrupado por hijo
 * (F-4-6). Solo lectura. La RLS de `recibos` y `lineas_recibo` restringen a la familia del
 * tutor (`es_tutor_de_familia`); devolvemos `null` (→ notFound) si el recibo no es visible.
 *
 * NO se sirve el BORRADOR: como en la lista, un recibo aún editable por Dirección no debe
 * verlo el tutor (aunque la RLS lo dejaría leer, el corte de borrador es de producto).
 */
export async function getReciboFamiliaDetalle(
  reciboId: string
): Promise<ReciboFamiliaDetalle | null> {
  const supabase = await createClient()

  const { data: recibo, error } = await supabase
    .from('recibos')
    .select(
      'id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, fecha_envio_banco, fecha_devolucion'
    )
    .eq('id', reciboId)
    .neq('estado', 'borrador')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    logger.warn('getReciboFamiliaDetalle: recibo', error.message)
    return null
  }
  if (!recibo) return null

  const { data: lineas } = await supabase
    .from('lineas_recibo')
    .select('id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos')
    .eq('recibo_id', reciboId)
    .order('created_at', { ascending: true })

  // Nombres de los hijos con línea (nino_id NOT NULL). La RLS de `ninos` deja al tutor leer
  // los hijos de su familia; los que no resuelvan caen al ninoId en el agrupado.
  const ninoIds = [
    ...new Set((lineas ?? []).map((l) => l.nino_id).filter((id): id is string => id != null)),
  ]
  const nombrePorNino = new Map<string, string>()
  if (ninoIds.length > 0) {
    const { data: ninos } = await supabase
      .from('ninos')
      .select('id, nombre, apellidos')
      .in('id', ninoIds)
    for (const n of ninos ?? []) {
      nombrePorNino.set(n.id, [n.nombre, n.apellidos].filter(Boolean).join(' '))
    }
  }

  const lineasConNino: LineaConNino[] = (lineas ?? []).map((l) => ({
    id: l.id,
    ninoId: l.nino_id,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitarioCentimos: l.precio_unitario_centimos,
    importeCentimos: l.importe_centimos,
  }))

  return {
    id: recibo.id,
    anio: recibo.anio,
    mes: recibo.mes,
    estado: recibo.estado,
    metodo: recibo.metodo,
    totalCentimos: recibo.total_centimos,
    esEsporadico: recibo.es_esporadico,
    conceptoEsporadico: recibo.concepto_esporadico,
    esRegiro: recibo.devuelto_de_recibo_id != null,
    fechaEnvioBanco: recibo.fecha_envio_banco,
    fechaDevolucion: recibo.fecha_devolucion,
    desglose: agruparLineasPorHijo(lineasConNino, nombrePorNino),
  }
}
