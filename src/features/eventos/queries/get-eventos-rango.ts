import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { EventoCalendario } from '../types'

const COLS =
  'id, ambito, tipo, titulo, descripcion, lugar, fecha, fecha_fin, hora_inicio, hora_fin, requiere_confirmacion, estado, aula_id, nino_id'

/**
 * Eventos del centro visibles para el usuario (RLS) que **solapan** el rango
 * `[desde, hasta]` (fechas 'YYYY-MM-DD'). Solape: empiezan en/antes de `hasta` y
 * terminan en/después de `desde` (día único por `fecha`, multi-día por
 * `fecha_fin`). Ordenados por fecha. Variante por rango exacto de
 * `getEventosMes`, usada por el resumen de Inicio (AG-15).
 */
export async function getEventosRango(
  centroId: string,
  desde: string,
  hasta: string
): Promise<EventoCalendario[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('eventos')
    .select(COLS)
    .eq('centro_id', centroId)
    .lte('fecha', hasta)
    .or(`fecha.gte.${desde},fecha_fin.gte.${desde}`)
    .order('fecha', { ascending: true })

  if (error) {
    logger.warn('getEventosRango failed', error.message)
    return []
  }

  return (data ?? []) as EventoCalendario[]
}
