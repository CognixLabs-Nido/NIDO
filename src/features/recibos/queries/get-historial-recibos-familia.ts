import 'server-only'

import { origenExceso } from '@/features/beca-comedor/lib/origen-exceso'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  construirHistorial,
  type EnlaceRemesaInput,
  type ReciboHistorial,
} from '../lib/historial-familia'

export type { ReciboHistorial } from '../lib/historial-familia'

/**
 * Lo que devuelve la lectura: el histórico, o que no se pudo leer. Un fallo no se convierte en
 * «sin recibos»: en la ficha, una lista vacía diría a la directora que a la familia no se le ha
 * cobrado nada.
 */
export type HistorialResult = { ok: true; recibos: ReciboHistorial[] } | { ok: false }

/**
 * Histórico de recibos de UNA familia para Dirección (F-6): todos sus recibos vivos, también los
 * borradores, con su estado y lo que pasó al cobrarlos (`construirHistorial`). RLS: Dirección del
 * centro. La familia y el centro los fija la página (`getFamiliaDetalle` con el centro activo).
 */
export async function getHistorialRecibosFamilia(
  familiaId: string,
  centroId: string
): Promise<HistorialResult> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select(
      'id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, diferencia_de_recibo_id, fecha_envio_banco, fecha_devolucion, devolucion_gastos_centimos, devolucion_salida, cobro_forma, cobro_fecha, cobro_nota, cobro_importe_centimos, created_at'
    )
    .eq('centro_id', centroId)
    .eq('familia_id', familiaId)
    .is('deleted_at', null)

  if (error) {
    logger.warn('getHistorialRecibosFamilia recibos', error.message)
    return { ok: false }
  }
  if (!recibos || recibos.length === 0) return { ok: true, recibos: [] }

  const ids = recibos.map((r) => r.id)

  const [enlacesRes, lineasRes, sobrantesRes] = await Promise.all([
    supabase
      .from('recibos_remesa')
      .select('recibo_id, remesa_id')
      .eq('centro_id', centroId)
      .in('recibo_id', ids),
    // Las líneas que traen dinero de otro recibo: una devolución arrastrada o un sobrante diferido.
    supabase
      .from('lineas_recibo')
      .select('recibo_id, importe_centimos, arrastre_de_recibo_id, sobrante_de_desborde_id')
      .eq('centro_id', centroId)
      .in('recibo_id', ids)
      .or('arrastre_de_recibo_id.not.is.null,sobrante_de_desborde_id.not.is.null'),
    // `*` para leer el origen también antes de que exista la columna (como `getRecibosGestion`).
    supabase
      .from('beca_comedor_desborde')
      .select('*')
      .eq('centro_id', centroId)
      .eq('familia_id', familiaId),
  ])
  const fallo = enlacesRes.error ?? lineasRes.error ?? sobrantesRes.error
  if (fallo) {
    logger.warn('getHistorialRecibosFamilia enlaces', fallo.message)
    return { ok: false }
  }

  // Solo cuentan las remesas vivas: el recibo de una remesa borrada quedó libre.
  const enlaces = enlacesRes.data ?? []
  const remesaIds = [...new Set(enlaces.map((e) => e.remesa_id))]
  let enlacesRemesa: EnlaceRemesaInput[] = []
  if (remesaIds.length > 0) {
    const { data: remesas, error: errRemesas } = await supabase
      .from('remesas')
      .select('id, anio, mes, estado')
      .eq('centro_id', centroId)
      .in('id', remesaIds)
      .is('deleted_at', null)
    if (errRemesas) {
      logger.warn('getHistorialRecibosFamilia remesas', errRemesas.message)
      return { ok: false }
    }
    const remesaPorId = new Map((remesas ?? []).map((r) => [r.id, r]))
    enlacesRemesa = enlaces.flatMap((e) => {
      const r = remesaPorId.get(e.remesa_id)
      return r ? [{ reciboId: e.recibo_id, anio: r.anio, mes: r.mes, estado: r.estado }] : []
    })
  }

  return {
    ok: true,
    recibos: construirHistorial({
      recibos,
      enlacesRemesa,
      lineasEnlazadas: (lineasRes.data ?? []).map((l) => ({
        reciboId: l.recibo_id,
        importeCentimos: l.importe_centimos,
        arrastreDeReciboId: l.arrastre_de_recibo_id,
        sobranteDeDesbordeId: l.sobrante_de_desborde_id,
      })),
      // Solo el sobrante de un cheque: el desborde de beca no es un cobro.
      sobrantes: (sobrantesRes.data ?? [])
        .filter((d) => origenExceso(d) === 'cheque')
        .map((d) => ({
          id: d.id,
          reciboId: d.recibo_id,
          excesoCentimos: d.exceso_centimos,
          estado: d.estado,
          via: d.via,
        })),
    }),
  }
}
