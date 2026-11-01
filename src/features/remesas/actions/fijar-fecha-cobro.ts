'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { claveErrorFechaCobro } from '../lib/errores-fecha-cobro'
import { fijarFechaCobroSchema, type FijarFechaCobroInput } from '../schemas/remesa'

/**
 * La misma fecha de cobro (o ninguna) a varios recibos de una vez, todos o ninguno. La puerta y
 * las reglas son de la BD: Dirección del centro, recibos por banco, en borrador o pendientes, y
 * fuera de una remesa enviada o con el fichero generado. Devuelve cuántos cambiaron.
 */
export async function fijarFechaCobro(
  input: FijarFechaCobroInput
): Promise<ActionResult<{ cambiados: number }>> {
  const parsed = fijarFechaCobroSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_fecha_cobro_recibos', {
    p_centro_id: parsed.data.centroId,
    p_recibo_ids: parsed.data.reciboIds,
    // NULL quita la fecha; el tipo generado no lo dice.
    p_fecha: parsed.data.fecha as string,
  })

  if (error) {
    logger.warn('fijarFechaCobro rpc error', error.code ?? '', error.hint ?? '')
    return fail(claveErrorFechaCobro(error))
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ cambiados: (data ?? []).filter((f) => f.resultado === 'cambiada').length })
}
