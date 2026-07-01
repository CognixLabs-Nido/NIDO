'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarCobradoManualSchema, type MarcarCobradoManualInput } from '../schemas/remesa'

/**
 * Marca un recibo como 'cobrado_manual' (cobrado en efectivo/transferencia, fuera de
 * SEPA). Aplica a un recibo 'devuelto' (rescatado a mano) o 'pendiente_procesar'. Anula
 * las fechas de banco/devolución (el CHECK exige ambas NULL en cobrado_manual); el
 * método NO se toca (sigue congelado). Solo admin (RLS).
 */
export async function marcarCobradoManual(
  input: MarcarCobradoManualInput
): Promise<ActionResult<null>> {
  const parsed = marcarCobradoManualSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()

  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, estado')
    .eq('id', parsed.data.reciboId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!recibo) return fail('remesas.errors.no_encontrada')
  if (recibo.estado !== 'devuelto' && recibo.estado !== 'pendiente_procesar') {
    return fail('remesas.errors.no_cobrable_manual')
  }

  const { data: actualizado, error } = await supabase
    .from('recibos')
    .update({ estado: 'cobrado_manual', fecha_envio_banco: null, fecha_devolucion: null })
    .eq('id', recibo.id)
    .in('estado', ['devuelto', 'pendiente_procesar'])
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarCobradoManual error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.cobrar_manual_failed')
  }
  if (!actualizado) return fail('remesas.errors.no_cobrable_manual')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
