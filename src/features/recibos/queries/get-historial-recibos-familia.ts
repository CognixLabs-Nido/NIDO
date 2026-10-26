import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { COLUMNAS_RECIBO_HISTORIAL, enriquecerHistorial } from './enriquecer-historial'

import type { ReciboHistorial } from '../lib/historial-familia'

export type { ReciboHistorial } from '../lib/historial-familia'

/**
 * Lo que devuelve la lectura: el histórico, o que no se pudo leer. Un fallo no se convierte en
 * «sin recibos»: en la ficha, una lista vacía diría a la directora que a la familia no se le ha
 * cobrado nada.
 */
export type HistorialResult = { ok: true; recibos: ReciboHistorial[] } | { ok: false }

/**
 * Histórico de recibos de UNA familia para Dirección (F-6): todos sus recibos vivos, también los
 * borradores, del más reciente al más antiguo, con su estado y lo que pasó al cobrarlos
 * (`enriquecerHistorial`). RLS: Dirección del centro. La familia y el centro los fija la página
 * (`getFamiliaDetalle` con el centro activo).
 */
export async function getHistorialRecibosFamilia(
  familiaId: string,
  centroId: string
): Promise<HistorialResult> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select(COLUMNAS_RECIBO_HISTORIAL)
    .eq('centro_id', centroId)
    .eq('familia_id', familiaId)
    .is('deleted_at', null)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('es_esporadico', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (error) {
    logger.warn('getHistorialRecibosFamilia recibos', error.message)
    return { ok: false }
  }
  const historial = await enriquecerHistorial(supabase, centroId, recibos ?? [])
  return historial ? { ok: true, recibos: historial } : { ok: false }
}
