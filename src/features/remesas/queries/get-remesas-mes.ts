import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type EstadoRemesa = Database['public']['Enums']['estado_remesa']

/** Un recibo de la remesa, con su fecha de cobro: para verla y para cambiarla. */
export interface ReciboDeRemesa {
  id: string
  familiaEtiqueta: string
  totalCentimos: number
  /** YYYY-MM-DD, o null: «en cuanto el banco pueda». */
  fechaCobro: string | null
}

export interface RemesaListItem {
  id: string
  estado: EstadoRemesa
  fechaEnvioBanco: string | null
  /** Se generó su fichero: ya no entra ni sale ningún recibo (`20261120120000`). */
  ficheroGenerado: boolean
  createdAt: string
  numRecibos: number
  totalCentimos: number
  /** Sus recibos, por familia. */
  recibos: ReciboDeRemesa[]
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
    // `*`: lee fichero_generado_at sin romper si el despliegue llega antes que su migración.
    .select('*')
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
    ? await supabase
        .from('recibos')
        .select('id, total_centimos, familia_id, fecha_cobro_banco')
        .in('id', reciboIds)
    : { data: [] }
  const familiaIds = [
    ...new Set((recibos ?? []).map((r) => r.familia_id).filter((f): f is string => f != null)),
  ]
  const { data: familias } = familiaIds.length
    ? await supabase.from('familias').select('id, etiqueta').in('id', familiaIds)
    : { data: [] }
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))
  const porId = new Map(
    (recibos ?? []).map((r) => [
      r.id,
      {
        id: r.id,
        familiaEtiqueta: (r.familia_id && etiquetaPorFamilia.get(r.familia_id)) || '',
        totalCentimos: r.total_centimos,
        fechaCobro: r.fecha_cobro_banco,
      },
    ])
  )

  const agregado = new Map<string, { num: number; total: number; recibos: ReciboDeRemesa[] }>()
  for (const e of enlaces ?? []) {
    const acc = agregado.get(e.remesa_id) ?? { num: 0, total: 0, recibos: [] }
    const recibo = porId.get(e.recibo_id)
    acc.num += 1
    acc.total += recibo?.totalCentimos ?? 0
    if (recibo) acc.recibos.push(recibo)
    agregado.set(e.remesa_id, acc)
  }

  return remesas.map((r) => {
    const acc = agregado.get(r.id) ?? { num: 0, total: 0, recibos: [] }
    return {
      id: r.id,
      estado: r.estado,
      fechaEnvioBanco: r.fecha_envio_banco,
      ficheroGenerado: r.fichero_generado_at != null,
      createdAt: r.created_at,
      numRecibos: acc.num,
      totalCentimos: acc.total,
      recibos: [...acc.recibos].sort(
        (a, b) =>
          a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES') || a.id.localeCompare(b.id)
      ),
    }
  })
}
