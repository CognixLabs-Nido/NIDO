import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { AusenciaRow } from '../types'

/**
 * Lista las ausencias de un niño ordenadas por fecha de inicio descendente.
 * RLS filtra: admin del centro, profe del aula actual, o tutor del niño.
 *
 * Las ausencias canceladas se devuelven con prefijo `[cancelada] ` en
 * `descripcion`; el caller decide si las muestra o no.
 */
export async function getAusenciasNino(ninoId: string): Promise<AusenciaRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ausencias')
    .select(
      'id, nino_id, fecha_inicio, fecha_fin, motivo, descripcion, reportada_por, created_at, updated_at'
    )
    .eq('nino_id', ninoId)
    .order('fecha_inicio', { ascending: false })
  if (error) return []
  return (data ?? []) as AusenciaRow[]
}
