'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarReciboDevueltoSchema, type MarcarReciboDevueltoInput } from '../schemas/remesa'

/**
 * Marca un recibo (que estaba 'enviado_banco') como 'devuelto' con la fecha de la
 * devolución, CONSERVANDO fecha_envio_banco (las R-transactions referencian el envío
 * original). Solo cambia estado + fecha_devolucion → pasa el congelado afinado de
 * B-5 aunque el mes esté cerrado. Solo admin (RLS).
 */
export async function marcarReciboDevuelto(
  input: MarcarReciboDevueltoInput
): Promise<ActionResult<null>> {
  const parsed = marcarReciboDevueltoSchema.safeParse(input)
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
  if (recibo.estado !== 'enviado_banco') return fail('remesas.errors.no_devolvible')

  const hoy = new Date().toISOString().slice(0, 10)

  const { data: actualizado, error } = await supabase
    .from('recibos')
    .update({ estado: 'devuelto', fecha_devolucion: hoy })
    .eq('id', recibo.id)
    .eq('estado', 'enviado_banco')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarReciboDevuelto error', error.message)
    if (error.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.devolver_failed')
  }
  if (!actualizado) return fail('remesas.errors.no_devolvible')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
