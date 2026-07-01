'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarRemesaEnviadaSchema, type MarcarRemesaEnviadaInput } from '../schemas/remesa'

/**
 * Marca una remesa BORRADOR como ENVIADA: fija fecha_envio_banco en la remesa y pasa
 * sus recibos a estado 'enviado_banco' con esa fecha (el congelado afinado de B-5
 * permite este avance de solo-estado en recibos de mes cerrado). Solo admin (RLS).
 */
export async function marcarRemesaEnviada(
  input: MarcarRemesaEnviadaInput
): Promise<ActionResult<null>> {
  const parsed = marcarRemesaEnviadaSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('remesas.errors.no_autorizado')

  const supabase = await createClient()

  const { data: remesa } = await supabase
    .from('remesas')
    .select('id, estado')
    .eq('id', parsed.data.remesaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!remesa) return fail('remesas.errors.no_encontrada')
  if (remesa.estado !== 'borrador') return fail('remesas.errors.ya_enviada')

  const hoy = new Date().toISOString().slice(0, 10)

  // Recibos incluidos en la remesa.
  const { data: enlaces } = await supabase
    .from('recibos_remesa')
    .select('recibo_id')
    .eq('remesa_id', remesa.id)
  const reciboIds = (enlaces ?? []).map((e) => e.recibo_id)

  // 1. Remesa → enviada (con fecha de envío al banco).
  const { data: actualizada, error: errRemesa } = await supabase
    .from('remesas')
    .update({ estado: 'enviada', fecha_envio_banco: hoy })
    .eq('id', remesa.id)
    .eq('estado', 'borrador')
    .select('id')
    .maybeSingle()

  if (errRemesa) {
    logger.warn('marcarRemesaEnviada update remesa error', errRemesa.message)
    if (errRemesa.code === '42501') return fail('remesas.errors.no_autorizado')
    return fail('remesas.errors.enviar_failed')
  }
  if (!actualizada) return fail('remesas.errors.ya_enviada')

  // 2. Recibos incluidos → enviado_banco con la misma fecha (solo estado/fecha:
  //    pasa el congelado afinado incluso en meses cerrados).
  if (reciboIds.length > 0) {
    const { error: errRecibos } = await supabase
      .from('recibos')
      .update({ estado: 'enviado_banco', fecha_envio_banco: hoy })
      .in('id', reciboIds)

    if (errRecibos) {
      logger.warn('marcarRemesaEnviada update recibos error', errRecibos.message)
      return fail('remesas.errors.enviar_recibos_failed')
    }
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
