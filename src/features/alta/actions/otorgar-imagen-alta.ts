'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Vía B (IU-2) — el checkbox "autorizo imagen" del alta OTORGA el consentimiento de
 * imagen del niño (fuente de verdad, IU-0) vía `otorgar_consentimiento_imagen`, en vez de
 * escribir `acuses_alta` tipo 'imagen'. Así el checkbox alimenta el MISMO consent por-niño
 * que la firma (vía A) y el flag `puede_aparecer_en_fotos` se deriva solo.
 *
 * `metodo='checkbox'` distingue esta aceptación de la firma dibujada ('digital'). `p_tutor`
 * = el que hace el alta (tutor o, en modo Dirección, la directora — igual que el acuse
 * anterior atribuía `firmante_id = auth.uid()`). El RPC (SECURITY DEFINER) exige
 * `es_admin(centro) O es_tutor_de(niño)`. El checkbox es monótono en UI (no se desmarca):
 * es otorgar-o-nada, sin revocación en el alta.
 */
const otorgarImagenAltaSchema = z.object({
  nino_id: z.string().uuid(),
})

export type OtorgarImagenAltaInput = z.infer<typeof otorgarImagenAltaSchema>

export async function otorgarConsentimientoImagenAlta(
  input: OtorgarImagenAltaInput
): Promise<ActionResult<{ ok: true }>> {
  const parsed = otorgarImagenAltaSchema.safeParse(input)
  if (!parsed.success) return fail('alta.errors.acuse_fallo')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { ip, userAgent } = await getRequestContext()
  const { error } = await supabase.rpc('otorgar_consentimiento_imagen', {
    p_nino_id: parsed.data.nino_id,
    p_tutor: user.id,
    p_version: CONSENT_VERSIONS.imagen,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
    p_metodo: 'checkbox',
  })
  if (error) {
    logger.warn('otorgarConsentimientoImagenAlta', error.message)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.errors.acuse_fallo')
  }

  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ ok: true })
}
