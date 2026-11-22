import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

export interface MandatoPorRefirmar {
  familiaId: string
  etiqueta: string
  fechaFirma: string | null
}

/**
 * 2026-11-22, decisión 6 del cierre del mandato (`docs/specs/mandato-sepa-cierre.md`): «Los dos
 * mandatos v1: no toques sus datos. Que Dirección los vea marcados como pendientes de refirmar, como
 * ve quién está sin SIP». Un mandato activo v1 se firmó antes de que el PDF llevara el identificador
 * de acreedor del centro y el documento y la dirección del titular. Se queda como está (la base no
 * deja tocarlo: `mandatos_sepa_v1_cerrado`) y la familia lo vuelve a firmar, que crea uno nuevo.
 *
 * `null` si no se lee: una lista vacía diría «ninguno pendiente».
 */
export async function getMandatosPorRefirmar(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<MandatoPorRefirmar[] | null> {
  const { data, error } = await supabase
    .from('mandatos_sepa')
    .select('familia_id, fecha_firma, familias!inner(etiqueta)')
    .eq('centro_id', centroId)
    .eq('estado', 'activo')
    .eq('version_canonico', 1)
    .is('deleted_at', null)
  if (error || !data) {
    logger.warn('getMandatosPorRefirmar', error?.code ?? 'sin_respuesta')
    return null
  }
  return data
    .filter((m): m is typeof m & { familia_id: string } => m.familia_id !== null)
    .map((m) => ({
      familiaId: m.familia_id,
      etiqueta: m.familias.etiqueta,
      fechaFirma: m.fecha_firma,
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
}
