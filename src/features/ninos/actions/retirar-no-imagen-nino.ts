'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { respuestaImagenNinoSchema, type RespuestaImagenNinoInput } from '../schemas/imagen'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * El tutor LEGAL retira su «no» a la imagen de su hijo, sin decir que sí (fase 10, 10a-2): queda sin
 * respuesta. Solo el suyo: el «no» de otro tutor lo retira solo Dirección, con su rastro
 * (`retirar_denegacion_imagen`). Devuelve cuántos retiró (0 si no tenía).
 */
export async function retirarNoImagenNino(
  input: RespuestaImagenNinoInput
): Promise<ActionResult<{ retirados: number }>> {
  const parsed = respuestaImagenNinoSchema.safeParse(input)
  if (!parsed.success) return fail('nino.imagen.errors.fallo_retirar_no')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('nino.imagen.errors.no_autorizado_denegar')

  const { data, error } = await supabase.rpc('retirar_denegacion_imagen', {
    p_nino_id: parsed.data.nino_id,
    p_tutor: user.id,
  })
  if (error) {
    logger.warn('retirarNoImagenNino', error.message)
    if (error.code === '42501') return fail('nino.imagen.errors.no_autorizado_denegar')
    return fail('nino.imagen.errors.fallo_retirar_no')
  }

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return ok({ retirados: data ?? 0 })
}
