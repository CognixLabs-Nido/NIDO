import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AutorizacionItem } from '../types'

/**
 * Lista de autorizaciones del centro (todos los tipos) para la vista admin/profe.
 * La RLS `autorizaciones_select` ya acota el alcance (admin → centro; profe →
 * niños/aulas de sus eventos). Incluye borradores y publicadas/anuladas. El
 * `tipo` se muestra como etiqueta en la UI (salida, reglas de régimen interno, …).
 */
export async function getAutorizacionesAdmin(): Promise<AutorizacionItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, estado, texto_definitivo, evento_id, nino_id, vigencia_desde, vigencia_hasta, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getAutorizacionesAdmin', error.message)
    return []
  }
  return (data ?? []) as AutorizacionItem[]
}
