'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'

import { respuestaImagenNinoSchema, type RespuestaImagenNinoInput } from '../schemas/imagen'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * El tutor LEGAL dice que no autoriza la imagen de su hijo, desde el portal de familia (fase 10,
 * 10a-2). `denegar_consentimiento_imagen` lo deja a nombre de quien llama, retira su propio «sí» y
 * nunca el del otro tutor. Con un «no» vigente de cualquiera el niño no aparece en las fotos
 * (decisión del responsable del 2026-11-17). Repetirlo no duplica nada.
 */
export async function denegarImagenNino(
  input: RespuestaImagenNinoInput
): Promise<ActionResult<{ ok: true }>> {
  const parsed = respuestaImagenNinoSchema.safeParse(input)
  if (!parsed.success) return fail('nino.imagen.errors.fallo_denegar')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('nino.imagen.errors.no_autorizado_denegar')

  const { ip, userAgent } = await getRequestContext()
  const { error } = await supabase.rpc('denegar_consentimiento_imagen', {
    p_nino_id: parsed.data.nino_id,
    p_tutor: user.id,
    p_version: CONSENT_VERSIONS.imagen_denegada,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
    p_metodo: 'checkbox',
  })
  if (error) {
    logger.warn('denegarImagenNino', error.message)
    if (error.code === '42501' || error.hint === 'no_es_tutor_legal')
      return fail('nino.imagen.errors.no_autorizado_denegar')
    return fail('nino.imagen.errors.fallo_denegar')
  }

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return ok({ ok: true })
}
