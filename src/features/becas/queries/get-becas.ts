import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface BecaListItem {
  id: string
  nino_id: string
  nino_nombre: string
  tipo_beca_id: string
  tipo_nombre: string
  importe_centimos: number
  fecha_desde: string
  fecha_hasta: string | null
}

// Becas vivas del centro, enriquecidas con nombre del niño y del tipo. Doble query
// (evita complejidad de embebido y respeta RLS por tabla), patrón de get-ninos.
export async function getBecas(centroId: string): Promise<BecaListItem[]> {
  const supabase = await createClient()

  const { data: becas } = await supabase
    .from('becas')
    .select('id, nino_id, tipo_beca_id, importe_centimos, fecha_desde, fecha_hasta')
    .eq('centro_id', centroId)
    .is('deleted_at', null)

  if (!becas?.length) return []

  const ninoIds = [...new Set(becas.map((b) => b.nino_id))]
  const tipoIds = [...new Set(becas.map((b) => b.tipo_beca_id))]

  const [{ data: ninos }, { data: tipos }] = await Promise.all([
    supabase.from('ninos').select('id, nombre, apellidos').in('id', ninoIds),
    supabase.from('tipos_beca').select('id, nombre').in('id', tipoIds),
  ])

  const nombreNino = new Map(
    (ninos ?? []).map((n) => [n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ')])
  )
  const nombreTipo = new Map((tipos ?? []).map((t) => [t.id, t.nombre]))

  return becas
    .map((b) => ({
      id: b.id,
      nino_id: b.nino_id,
      nino_nombre: nombreNino.get(b.nino_id) ?? '—',
      tipo_beca_id: b.tipo_beca_id,
      tipo_nombre: nombreTipo.get(b.tipo_beca_id) ?? '—',
      importe_centimos: b.importe_centimos,
      fecha_desde: b.fecha_desde,
      fecha_hasta: b.fecha_hasta,
    }))
    .sort((a, b) => a.nino_nombre.localeCompare(b.nino_nombre))
}
