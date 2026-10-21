import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AutorizacionItem } from '../types'

import { getEstadoFirmaPorInstancia } from './estado-firma-instancias'

/**
 * Lista de **instancias** firmables del centro (`es_plantilla=false`: salida,
 * reglas/imágenes enviadas a una audiencia, recogida/medicación de la familia,
 * y filas legacy) para la vista admin/profe. Las **plantillas** del catálogo van
 * en `getPlantillasCatalogo`. La RLS `autorizaciones_select` acota el rol (admin → sus
 * centros; profe → niños/aulas de sus eventos), pero no el centro: con dos centros traería los
 * de todos. Por eso filtra por `centroId`, el de la página.
 *
 * Las recogidas y medicaciones de la familia (B2, una por niño) llevan además su
 * `estado_firma`: el estado del documento no cambia al revocar, y sin él una recogida
 * revocada se listaba igual que una vigente.
 */
export async function getAutorizacionesAdmin(centroId: string): Promise<AutorizacionItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, estado, texto_definitivo, evento_id, nino_id, es_plantilla, ambito, vigencia_desde, vigencia_hasta, created_at, firmantes_requeridos'
    )
    .eq('centro_id', centroId)
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getAutorizacionesAdmin', error.message)
    return []
  }
  const filas = data ?? []
  const estados = await getEstadoFirmaPorInstancia(
    supabase,
    filas.filter((a) => a.tipo === 'recogida' || a.tipo === 'medicacion')
  )
  return filas.map(({ firmantes_requeridos: _politica, ...a }) => ({
    ...a,
    ...(estados.has(a.id) ? { estado_firma: estados.get(a.id) } : {}),
  })) as AutorizacionItem[]
}
