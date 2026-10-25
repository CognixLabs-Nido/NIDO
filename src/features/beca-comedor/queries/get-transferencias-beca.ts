import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { origenExceso, type OrigenExceso } from '../lib/origen-exceso'

export interface TransferenciaBecaItem {
  id: string
  familiaEtiqueta: string
  importeCentimos: number
  anio: number
  mes: number
  realizadaAt: string | null
  /** PR-1c: el exceso de una beca o el sobrante de un cheque guardería / ticket restaurant. */
  origen: OrigenExceso
}

export interface TransferenciasBecaData {
  pendientes: TransferenciaBecaItem[]
  realizadas: TransferenciaBecaItem[]
}

const VACIO: TransferenciasBecaData = { pendientes: [], realizadas: [] }

/**
 * V2-5 — Transferencias de beca comedor del centro (devolución del exceso a la familia).
 * Las 'pendientes' (creadas al resolver un desborde vía transferencia) se pagan por banco y
 * se marcan realizadas. Las 'realizadas' se listan con su sello (no se borran al regenerar:
 * recibo_id pasa a NULL, la fila sobrevive colgada de la familia). PR-1c: también las del sobrante
 * de un cheque, con su origen. RLS: admin del centro.
 */
export async function getTransferenciasBeca(centroId: string): Promise<TransferenciasBecaData> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('beca_comedor_transferencia')
    // `*` para leer el origen también antes de que exista la columna (PR-1c).
    .select('*')
    .eq('centro_id', centroId)
    .order('anio', { ascending: true })
    .order('mes', { ascending: true })

  if (error) {
    logger.warn('getTransferenciasBeca', error.message)
    return VACIO
  }
  const filas = data ?? []
  if (filas.length === 0) return VACIO

  const familiaIds = [...new Set(filas.map((f) => f.familia_id))]
  const { data: familias } = await supabase
    .from('familias')
    .select('id, etiqueta')
    .in('id', familiaIds)
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))

  const toItem = (f: (typeof filas)[number]): TransferenciaBecaItem => ({
    id: f.id,
    familiaEtiqueta: etiquetaPorFamilia.get(f.familia_id) ?? '',
    importeCentimos: f.importe_centimos,
    anio: f.anio,
    mes: f.mes,
    realizadaAt: f.realizada_at,
    origen: origenExceso(f),
  })

  const pendientes = filas.filter((f) => f.estado === 'pendiente').map(toItem)
  const realizadas = filas
    .filter((f) => f.estado === 'realizada')
    .map(toItem)
    .sort((a, b) => (b.realizadaAt ?? '').localeCompare(a.realizadaAt ?? ''))

  return { pendientes, realizadas }
}
