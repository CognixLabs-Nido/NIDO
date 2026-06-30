'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cerrarMesSchema, type CerrarMesInput } from '../schemas/cierre'

/**
 * Cierra el mes (centro actual, anio, mes) llamando a la RPC atómica e idempotente
 * `cerrar_mes_cobros`: genera recibos + líneas congelando precio y método, y ancla el
 * cierre. Volver a cerrar el mismo mes es no-op. Solo admin (la RPC lo verifica).
 */
export async function cerrarMes(
  input: CerrarMesInput
): Promise<ActionResult<{ cierreId: string }>> {
  const parsed = cerrarMesSchema.safeParse(input)
  if (!parsed.success) return fail('cierre_cobros.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('cierre_cobros.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cerrar_mes_cobros', {
    p_centro_id: centroId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
  })

  if (error || !data) {
    logger.warn('cerrarMes error', error?.message)
    if (error?.code === '42501') return fail('cierre_cobros.errors.no_autorizado')
    return fail('cierre_cobros.errors.cerrar_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ cierreId: data })
}
