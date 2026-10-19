'use server'

import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
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
export async function proponerAsignaciones(
  centroId: string
): Promise<ActionResult<{ propuestas: number }>> {
  // Centro EXPLÍCITO de la página (multicentro · Fase 1): admin en él, no el de la cookie.
  const supabase = await createClient()
  if (!(await usuarioAdminEn(supabase, centroId))) return fail('cuotas_config.errors.no_autorizado')
  const { data, error } = await supabase.rpc('proponer_asignaciones', { p_centro_id: centroId })

  if (error || data === null) {
    logger.warn('proponerAsignaciones error', error?.message)
    if (error?.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.proponer_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ propuestas: data })
}
