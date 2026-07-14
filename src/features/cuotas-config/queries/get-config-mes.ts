import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getNinosPorCentro } from '@/features/ninos/queries/get-ninos'
import type { Database } from '@/types/database'

type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ConfigNinoMes {
  nino_id: string
  nombre: string
  metodo: MetodoPago | null
  /** conceptoIds asignados PERMANENTEMENTE a ese niño (asignacion_concepto, sin mes). */
  conceptosAsignados: string[]
}

// F-4-2: configuración de cobro. Por cada niño activo del centro, su método de pago del
// mes (metodo_pago_familia, sigue por mes) y sus conceptos ASIGNADOS de forma permanente
// (asignacion_concepto, SIN mes). Solo lectura; el panel edita con asignar/desasignar.
export async function getConfigMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<ConfigNinoMes[]> {
  const supabase = await createClient()

  const ninos = (await getNinosPorCentro(centroId)).filter((n) => n.estado_matricula === 'activa')
  if (ninos.length === 0) return []

  const [{ data: metodos }, { data: asignaciones }] = await Promise.all([
    supabase
      .from('metodo_pago_familia')
      .select('nino_id, metodo')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .is('deleted_at', null),
    // Asignación permanente por niño (sin filtro de mes). Las asignaciones por FAMILIA
    // (descuento hermanos) no se muestran en este panel por-niño (llega en F-4-4).
    supabase
      .from('asignacion_concepto')
      .select('nino_id, concepto_id')
      .eq('centro_id', centroId)
      .not('nino_id', 'is', null)
      .is('deleted_at', null),
  ])

  const metodoPorNino = new Map<string, MetodoPago>()
  for (const m of metodos ?? []) metodoPorNino.set(m.nino_id, m.metodo)

  const conceptosPorNino = new Map<string, string[]>()
  for (const a of asignaciones ?? []) {
    if (!a.nino_id) continue
    const actual = conceptosPorNino.get(a.nino_id) ?? []
    actual.push(a.concepto_id)
    conceptosPorNino.set(a.nino_id, actual)
  }

  return ninos.map((n) => ({
    nino_id: n.id,
    nombre: [n.nombre, n.apellidos].filter(Boolean).join(' '),
    metodo: metodoPorNino.get(n.id) ?? null,
    conceptosAsignados: conceptosPorNino.get(n.id) ?? [],
  }))
}
