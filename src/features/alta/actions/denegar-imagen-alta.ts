'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * El «no» de la imagen en el alta (fase 10, 10a-2): el tutor legal contesta que no autoriza el uso de
 * la imagen de su hijo, por `denegar_consentimiento_imagen`. Es una respuesta y no frena el alta
 * (decisión del responsable del 2026-11-17, art. 7.4). Retira su propio «sí», nunca el del otro tutor,
 * y con un «no» vigente el niño no aparece en las fotos aunque el otro tutor diga que sí.
 *
 * Solo del tutor: en el alta en papel (Dirección) el «no» espera a decidir a qué tutor se atribuye.
 */
const denegarImagenAltaSchema = z.object({ nino_id: z.string().uuid() })

export async function denegarConsentimientoImagenAlta(
  input: z.infer<typeof denegarImagenAltaSchema>
): Promise<ActionResult<{ ok: true }>> {
  const parsed = denegarImagenAltaSchema.safeParse(input)
  if (!parsed.success) return fail('alta.errors.acuse_fallo')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

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
    logger.warn('denegarConsentimientoImagenAlta', error.message)
    if (error.code === '42501' || error.hint === 'no_es_tutor_legal')
      return fail('alta.errors.no_autorizado')
    return fail('alta.errors.acuse_fallo')
  }

  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ ok: true })
}
