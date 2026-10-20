import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { VinculoParentesco } from '@/features/familias/lib/resolver-parentesco'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type ServiceClient = SupabaseClient<Database>

/**
 * Vínculo del que HEREDA el parentesco un hijo nuevo del tutor (el más reciente).
 *
 * UNA sola definición de "tiene vínculo del que heredar" para los dos sitios que la necesitan:
 *  - `vincularHijoATutorExistente` (al promover), y
 *  - la lista de Admisiones (`necesita_parentesco`: si "Invitar" debe pedir el parentesco).
 * Si divergieran, el diálogo dejaría de pedir el parentesco justo cuando la acción lo exige.
 *
 * Filtros (los MISMOS en las dos funciones de este módulo):
 *  - por `usuario_id` del tutor y por los niños de ESTE centro (PR 1 de la Fase 4): lo que el
 *    tutor declaró en otro centro es de ese otro responsable, y no se copia aquí;
 *  - SIN filtrar `deleted_at` a propósito: un vínculo archivado sigue diciendo la verdad del
 *    parentesco (familia reactivada, F-2b-4-1).
 * Va por service role: un vínculo archivado no lo ve la RLS del admin.
 */
export async function buscarVinculoPrevio(
  service: ServiceClient,
  tutorUsuarioId: string,
  centroId: string
): Promise<VinculoParentesco | null> {
  const { data } = await service
    .from('vinculos_familiares')
    .select('parentesco, descripcion_parentesco, ninos!inner(centro_id)')
    .eq('usuario_id', tutorUsuarioId)
    .eq('ninos.centro_id', centroId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
    ? { parentesco: data.parentesco, descripcion_parentesco: data.descripcion_parentesco }
    : null
}

/**
 * Versión por lotes de `buscarVinculoPrevio` (mismos filtros): de entre `tutorUsuarioIds`,
 * cuáles tienen AL MENOS un vínculo del que heredar. `null` si la lectura falla — quien llama
 * decide (la lista no pide el campo de entrada y el diálogo lo revela si la acción lo exige).
 */
export async function tutoresConVinculoPrevio(
  service: ServiceClient,
  tutorUsuarioIds: string[],
  centroId: string
): Promise<Set<string> | null> {
  if (tutorUsuarioIds.length === 0) return new Set()
  const { data, error } = await service
    .from('vinculos_familiares')
    .select('usuario_id, ninos!inner(centro_id)')
    .in('usuario_id', tutorUsuarioIds)
    .eq('ninos.centro_id', centroId)
  if (error) {
    logger.warn('tutoresConVinculoPrevio', error.message)
    return null
  }
  return new Set((data ?? []).map((v) => v.usuario_id))
}
