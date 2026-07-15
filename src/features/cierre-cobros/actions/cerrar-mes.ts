'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cerrarMesSchema, type CerrarMesInput } from '../schemas/cierre'

/**
 * F-4-3: GENERA los borradores familiares del mes (centro actual, anio, mes) vía la RPC
 * `generar_recibos_mes`: 1 recibo por familia en estado 'borrador' con las líneas de todos
 * los hijos. Re-ejecutable (respeta los ya confirmados). La CONFIRMACIÓN por recibo y el
 * anclaje del cierre son de `confirmar_recibo` (UI de F-4-4). Solo admin (la RPC lo verifica).
 */
export async function cerrarMes(
  input: CerrarMesInput
): Promise<ActionResult<{ generados: number }>> {
  const parsed = cerrarMesSchema.safeParse(input)
  if (!parsed.success) return fail('cierre_cobros.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('cierre_cobros.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generar_recibos_mes', {
    p_centro_id: centroId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
  })

  if (error || data === null) {
    logger.warn('cerrarMes error', error?.message)
    if (error?.code === '42501') return fail('cierre_cobros.errors.no_autorizado')
    return fail('cierre_cobros.errors.cerrar_failed')
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ generados: data })
}
