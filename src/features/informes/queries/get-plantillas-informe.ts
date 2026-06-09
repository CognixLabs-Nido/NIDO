import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { parseEstructura } from '../lib/estructura'
import type { PlantillaInformeItem } from '../types'

/**
 * Plantillas de informe del centro, filtradas por estado. La RLS
 * `plantillas_informe_select` deja verlas al staff del centro (la familia no);
 * la página admin gatea por rol. Activas para gestionar; archivadas en su vista
 * aparte («ver archivadas», patrón histórico de F8).
 */
export async function getPlantillasInforme(
  soloArchivadas = false
): Promise<PlantillaInformeItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantillas_informe')
    .select('id, titulo, estado, estructura, archivada_at, created_at, updated_at')
    .eq('estado', soloArchivadas ? 'archivada' : 'activa')
    .order('titulo', { ascending: true })

  if (error) {
    logger.warn('getPlantillasInforme', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    titulo: row.titulo,
    estado: row.estado,
    estructura: parseEstructura(row.estructura),
    archivada_at: row.archivada_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}
