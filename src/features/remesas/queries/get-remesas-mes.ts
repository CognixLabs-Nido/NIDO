import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type EstadoRemesa = Database['public']['Enums']['estado_remesa']

export interface RemesaListItem {
  id: string
  estado: EstadoRemesa
  fechaEnvioBanco: string | null
  createdAt: string
  numRecibos: number
  totalCentimos: number
}

/**
 * Remesas del periodo (borrador/enviada) con nº de recibos y suma de importes. RLS:
 * solo admin del centro. Puede haber >1 remesa por mes (re-giros de devoluciones).
 */
export async function getRemesasMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<RemesaListItem[]> {
  const supabase = await createClient()

  const { data: remesas } = await supabase
    .from('remesas')
    .select('id, estado, fecha_envio_banco, created_at')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (!remesas || remesas.length === 0) return []

  // Recibos ligados a estas remesas + su importe (selects separados, unidos en
  // memoria: las tablas B-0 se tiparon a mano sin metadata de relaciones).
  const ids = remesas.map((r) => r.id)
  const { data: enlaces } = await supabase
    .from('recibos_remesa')
    .select('remesa_id, recibo_id')
    .in('remesa_id', ids)

  const reciboIds = [...new Set((enlaces ?? []).map((e) => e.recibo_id))]
  const { data: recibos } = reciboIds.length
    ? await supabase.from('recibos').select('id, total_centimos').in('id', reciboIds)
    : { data: [] }
  const totalPorRecibo = new Map((recibos ?? []).map((r) => [r.id, r.total_centimos]))

  const agregado = new Map<string, { num: number; total: number }>()
  for (const e of enlaces ?? []) {
    const acc = agregado.get(e.remesa_id) ?? { num: 0, total: 0 }
    acc.num += 1
    acc.total += totalPorRecibo.get(e.recibo_id) ?? 0
    agregado.set(e.remesa_id, acc)
  }

  return remesas.map((r) => {
    const acc = agregado.get(r.id) ?? { num: 0, total: 0 }
    return {
      id: r.id,
      estado: r.estado,
      fechaEnvioBanco: r.fecha_envio_banco,
      createdAt: r.created_at,
      numRecibos: acc.num,
      totalCentimos: acc.total,
    }
  })
}
