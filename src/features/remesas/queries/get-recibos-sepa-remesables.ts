import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface ReciboSepaRemesable {
  id: string
  ninoId: string
  ninoNombre: string
  totalCentimos: number
  esEsporadico: boolean
  /** ¿El niño tiene un mandato SEPA activo? (si no, no debería entrar a la remesa). */
  tieneMandato: boolean
}

/**
 * Recibos de método 'sepa' del periodo que AÚN no están en ninguna remesa, con el
 * nombre del niño y si tiene mandato activo. Base para el marcado de la remesa por
 * la directora. RLS: solo admin del centro. Excluye importes ≤ 0 (no domiciliables).
 */
export async function getRecibosSepaRemesables(
  centroId: string,
  anio: number,
  mes: number
): Promise<ReciboSepaRemesable[]> {
  const supabase = await createClient()

  const { data: recibos } = await supabase
    .from('recibos')
    .select('id, nino_id, total_centimos, es_esporadico')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('metodo', 'sepa')
    .is('deleted_at', null)
    .gt('total_centimos', 0)

  if (!recibos || recibos.length === 0) return []

  const ninoIds = [...new Set(recibos.map((r) => r.nino_id))]
  const [{ data: yaEnRemesa }, { data: mandatos }, { data: ninos }] = await Promise.all([
    supabase.from('recibos_remesa').select('recibo_id').eq('centro_id', centroId),
    supabase
      .from('mandatos_sepa')
      .select('nino_id')
      .eq('centro_id', centroId)
      .eq('estado', 'activo')
      .is('deleted_at', null),
    supabase.from('ninos').select('id, nombre, apellidos').in('id', ninoIds),
  ])

  const remesados = new Set((yaEnRemesa ?? []).map((r) => r.recibo_id))
  const conMandato = new Set((mandatos ?? []).map((m) => m.nino_id))
  const nombrePorNino = new Map(
    (ninos ?? []).map((n) => [n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ')])
  )

  return recibos
    .filter((r) => !remesados.has(r.id))
    .map((r) => ({
      id: r.id,
      ninoId: r.nino_id,
      ninoNombre: nombrePorNino.get(r.nino_id) ?? '',
      totalCentimos: r.total_centimos,
      esEsporadico: r.es_esporadico,
      tieneMandato: conMandato.has(r.nino_id),
    }))
}
