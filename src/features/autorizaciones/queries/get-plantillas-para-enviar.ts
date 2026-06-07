import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { PlantillaEnviableItem } from '../types'

/**
 * Plantillas **publicadas y definitivas de tipo A** (reglas/imágenes) listas
 * para «Enviar» a una audiencia. recogida/medicación (tipos B) quedan fuera: las
 * inicia la familia, no se envían. Una borrador/anulada tampoco aparece (solo el
 * formato vigente del catálogo es enviable).
 */
export async function getPlantillasParaEnviar(): Promise<PlantillaEnviableItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('autorizaciones')
    .select('id, tipo, titulo')
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .in('tipo', ['reglas_regimen_interno', 'autorizacion_imagenes'])
    .order('tipo', { ascending: true })

  if (error) {
    logger.warn('getPlantillasParaEnviar', error.message)
    return []
  }
  return (data ?? []) as PlantillaEnviableItem[]
}
