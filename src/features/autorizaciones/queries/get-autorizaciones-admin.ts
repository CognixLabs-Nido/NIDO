import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AutorizacionItem } from '../types'

/**
 * Lista de **instancias** firmables del centro (`es_plantilla=false`: salida,
 * reglas/imágenes enviadas a una audiencia, recogida/medicación de la familia,
 * y filas legacy) para la vista admin/profe. Las **plantillas** del catálogo van
 * en `getPlantillasCatalogo`. La RLS `autorizaciones_select` ya acota el alcance
 * (admin → centro; profe → niños/aulas de sus eventos).
 */
export async function getAutorizacionesAdmin(): Promise<AutorizacionItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, estado, texto_definitivo, evento_id, nino_id, es_plantilla, ambito, vigencia_desde, vigencia_hasta, created_at'
    )
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getAutorizacionesAdmin', error.message)
    return []
  }
  return (data ?? []) as AutorizacionItem[]
}
