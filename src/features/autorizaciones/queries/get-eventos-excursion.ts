import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface EventoExcursionOption {
  id: string
  titulo: string
  fecha: string
}

/**
 * Eventos `tipo='excursion'` activos del centro a los que el admin/profe puede
 * colgar una autorización de salida. La RLS de `eventos` ya acota el alcance por
 * rol. Excluye cancelados; ordena por fecha ascendente.
 */
export async function getEventosExcursion(centroId: string): Promise<EventoExcursionOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('eventos')
    .select('id, titulo, fecha, estado')
    .eq('centro_id', centroId)
    .eq('tipo', 'excursion')
    .neq('estado', 'cancelado')
    .order('fecha', { ascending: true })

  if (error) {
    logger.warn('getEventosExcursion', error.message)
    return []
  }
  return (data ?? []).map((e) => ({ id: e.id, titulo: e.titulo, fecha: e.fecha }))
}
