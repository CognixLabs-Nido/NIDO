'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

/**
 * F-4-4: siembra las asignaciones automáticas del centro vía `proponer_asignaciones`
 * (conceptos aplicacion='automatico' → filas origen='automatico' por alumno/familia).
 * Idempotente y NO destructiva: respeta las bajas manuales. Devuelve cuántas propuso.
 * Solo admin (la RPC lo verifica).
 */
export async function proponerAsignaciones(): Promise<ActionResult<{ propuestas: number }>> {
  const centroId = await getCentroActualId()
  if (!centroId) return fail('cuotas_config.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('proponer_asignaciones', { p_centro_id: centroId })

  if (error || data === null) {
    logger.warn('proponerAsignaciones error', error?.message)
    if (error?.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.proponer_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ propuestas: data })
}
