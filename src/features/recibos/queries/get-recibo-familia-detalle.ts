import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface LineaReciboFamilia {
  id: string
  descripcion: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
}

export interface ReciboFamiliaDetalle {
  id: string
  ninoId: string
  ninoNombre: string
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
  lineas: LineaReciboFamilia[]
}

/**
 * Detalle de UN recibo del hijo del tutor legal con su desglose de líneas (conceptos +
 * becas negativas + saldo arrastrado). Solo lectura. La RLS de `recibos` y de
 * `lineas_recibo` restringen a los hijos del tutor; devolvemos `null` si el recibo no
 * es visible (RLS → 0 filas) para que la página muestre notFound.
 */
export async function getReciboFamiliaDetalle(
  reciboId: string
): Promise<ReciboFamiliaDetalle | null> {
  const supabase = await createClient()

  const { data: recibo, error } = await supabase
    .from('recibos')
    .select(
      'id, nino_id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, fecha_envio_banco, fecha_devolucion'
    )
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    logger.warn('getReciboFamiliaDetalle: recibo', error.message)
    return null
  }
  if (!recibo) return null

  // F-4-1: nino_id es opcional en el recibo familiar. El detalle familiar (varios hijos) se
  // rehace en F-4-4; hasta entonces, si no hay nino_id, el nombre queda vacío.
  const [{ data: nino }, { data: lineas }] = await Promise.all([
    supabase.from('ninos').select('nombre, apellidos').eq('id', recibo.nino_id ?? '').maybeSingle(),
    supabase
      .from('lineas_recibo')
      .select('id, descripcion, cantidad, precio_unitario_centimos, importe_centimos')
      .eq('recibo_id', reciboId)
      .order('created_at', { ascending: true }),
  ])

  return {
    id: recibo.id,
    ninoId: recibo.nino_id ?? '',
    ninoNombre: nino ? [nino.nombre, nino.apellidos].filter(Boolean).join(' ') : '',
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
    lineas: (lineas ?? []).map((l) => ({
      id: l.id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitarioCentimos: l.precio_unitario_centimos,
      importeCentimos: l.importe_centimos,
    })),
  }
}
