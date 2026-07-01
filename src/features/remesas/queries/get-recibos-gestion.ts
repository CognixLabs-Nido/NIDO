import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']

export interface ReciboGestion {
  id: string
  ninoNombre: string
  totalCentimos: number
  estado: EstadoRecibo
  fechaEnvioBanco: string | null
  fechaDevolucion: string | null
  /** ¿Es un recibo de re-giro (ligado a un devuelto)? */
  esRegiro: boolean
}

/**
 * Recibos del periodo ya en el ciclo de cobro (enviado_banco / devuelto /
 * cobrado_manual) para la gestión de devoluciones. RLS: solo admin del centro.
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
      'id, nino_id, total_centimos, estado, fecha_envio_banco, fecha_devolucion, devuelto_de_recibo_id'
    )
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .in('estado', ['enviado_banco', 'devuelto', 'cobrado_manual'])
    .is('deleted_at', null)
    .order('estado', { ascending: true })

  if (!recibos || recibos.length === 0) return []

  const ninoIds = [...new Set(recibos.map((r) => r.nino_id))]
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .in('id', ninoIds)
  const nombrePorNino = new Map(
    (ninos ?? []).map((n) => [n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ')])
  )

  return recibos.map((r) => ({
    id: r.id,
    ninoNombre: nombrePorNino.get(r.nino_id) ?? '',
    totalCentimos: r.total_centimos,
    estado: r.estado,
    fechaEnvioBanco: r.fecha_envio_banco,
    fechaDevolucion: r.fecha_devolucion,
    esRegiro: r.devuelto_de_recibo_id != null,
  }))
}
