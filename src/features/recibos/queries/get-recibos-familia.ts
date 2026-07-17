import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ReciboFamiliaItem {
  id: string
  anio: number
  mes: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
  esEsporadico: boolean
  conceptoEsporadico: string | null
  /** Recibo de re-giro (ligado a un devuelto): lo señalamos a la familia. */
  esRegiro: boolean
  /** Solo esporádicos: hijo concreto al que se carga (NULL = cargo familiar). */
  ninoId: string | null
  ninoNombre: string | null
  createdAt: string
}

/**
 * Recibos de la FAMILIA del tutor legal (F-4-6), grano familia: cada recibo es UNA fila
 * (regular del mes, esporádico o re-giro), ordenados por período descendente. Solo lectura.
 *
 * La RLS de `recibos` ya filtra por `es_tutor_de_familia`, así que solo llegan los recibos
 * de la familia del tutor (relación 1:1). NO se listan los BORRADORES: un recibo en
 * 'borrador' aún no lo ha confirmado Dirección (puede editarse) → el tutor solo ve los que
 * han salido de borrador. Los esporádicos pueden llevar `nino_id` (cargo de un hijo
 * concreto): se resuelve su nombre para indicarlo; los regulares y los cargos de familia
 * llevan `nino_id` NULL.
 */
export async function getRecibosFamilia(): Promise<ReciboFamiliaItem[]> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select(
      'id, nino_id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, created_at'
    )
    .neq('estado', 'borrador') // el tutor no ve recibos aún editables por Dirección
    .is('deleted_at', null)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getRecibosFamilia', error.message)
    return []
  }
  if (!recibos || recibos.length === 0) return []

  // Nombres de los hijos referidos por esporádicos con nino_id (los regulares llevan NULL).
  const ninoIds = [
    ...new Set(recibos.map((r) => r.nino_id).filter((id): id is string => id != null)),
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

  return recibos.map((r) => ({
    id: r.id,
    anio: r.anio,
    mes: r.mes,
    estado: r.estado,
    metodo: r.metodo,
    totalCentimos: r.total_centimos,
    esEsporadico: r.es_esporadico,
    conceptoEsporadico: r.concepto_esporadico,
    esRegiro: r.devuelto_de_recibo_id != null,
    ninoId: r.nino_id,
    ninoNombre: r.nino_id ? (nombrePorNino.get(r.nino_id) ?? null) : null,
    createdAt: r.created_at,
  }))
}

/** Todos los ids de recibos visibles (para marcarlos como vistos al abrir la lista). */
export function idsDeRecibos(recibos: ReciboFamiliaItem[]): string[] {
  return recibos.map((r) => r.id)
}
