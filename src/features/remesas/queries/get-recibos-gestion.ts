import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']

export interface ReciboGestion {
  id: string
  /** F-4-5: los recibos son familiares → se muestra la familia (antes el niño). */
  familiaEtiqueta: string
  totalCentimos: number
  estado: EstadoRecibo
  fechaEnvioBanco: string | null
  fechaDevolucion: string | null
  /** ¿Es un recibo de re-giro (ligado a un devuelto)? */
  esRegiro: boolean
}

/**
 * Recibos del periodo ya en el ciclo de cobro (enviado_banco / devuelto /
 * cobrado_manual) para la gestión de devoluciones, a grano FAMILIA. RLS: solo admin
 * del centro.
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
      'id, familia_id, total_centimos, estado, fecha_envio_banco, fecha_devolucion, devuelto_de_recibo_id'
    )
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .in('estado', ['enviado_banco', 'devuelto', 'cobrado_manual'])
    .is('deleted_at', null)
    .order('estado', { ascending: true })

  if (!recibos || recibos.length === 0) return []

  const familiaIds = [
    ...new Set(recibos.map((r) => r.familia_id).filter((x): x is string => x != null)),
  ]
  const { data: familias } = await supabase
    .from('familias')
    .select('id, etiqueta')
    .in('id', familiaIds)
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))

  return recibos.map((r) => ({
    id: r.id,
    familiaEtiqueta: r.familia_id ? (etiquetaPorFamilia.get(r.familia_id) ?? '') : '',
    totalCentimos: r.total_centimos,
    estado: r.estado,
    fechaEnvioBanco: r.fecha_envio_banco,
    fechaDevolucion: r.fecha_devolucion,
    esRegiro: r.devuelto_de_recibo_id != null,
  }))
}
