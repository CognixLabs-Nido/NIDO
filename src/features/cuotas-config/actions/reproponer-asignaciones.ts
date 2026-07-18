'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

/**
 * D-5 (punto 1): "Re-proponer desde cero" vía `reproponer_asignaciones`. A diferencia
 * de `proponerAsignaciones` (aditivo, respeta las bajas), este REVIVE las asignaciones
 * origen='automatico' soft-borradas por error que hoy cumplen la regla del concepto, y
 * siembra las que falten. NUNCA toca las manuales ni borra nada. Devuelve el desglose
 * { revividas, sembradas }. Solo admin (la RPC lo verifica).
 */
export async function reproponerAsignaciones(): Promise<
  ActionResult<{ revividas: number; sembradas: number }>
> {
  const centroId = await getCentroActualId()
  if (!centroId) return fail('cuotas_config.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reproponer_asignaciones', { p_centro_id: centroId })

  if (error || data === null) {
    logger.warn('reproponerAsignaciones error', error?.message)
    if (error?.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.proponer_failed')
  }

  const { revividas, sembradas } = data as { revividas: number; sembradas: number }
  revalidatePath(RUTA, 'page')
  return ok({ revividas, sembradas })
}
