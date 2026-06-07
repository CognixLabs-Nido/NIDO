import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { PlantillaCatalogoItem } from '../types'

/**
 * Catálogo de **plantillas durables** del centro (`es_plantilla=true`): los
 * formatos estándar (reglas/imágenes/recogida/medicación). La RLS
 * `autorizaciones_select` deja ver las plantillas a los miembros del centro;
 * aquí solo las muestra la vista admin (la página gatea por rol). Incluye
 * borradores/publicadas/anuladas para que el admin gestione el ciclo.
 */
export async function getPlantillasCatalogo(): Promise<PlantillaCatalogoItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('autorizaciones')
    .select('id, tipo, titulo, estado, texto_definitivo')
    .eq('es_plantilla', true)
    .order('tipo', { ascending: true })

  if (error) {
    logger.warn('getPlantillasCatalogo', error.message)
    return []
  }
  return (data ?? []) as PlantillaCatalogoItem[]
}
