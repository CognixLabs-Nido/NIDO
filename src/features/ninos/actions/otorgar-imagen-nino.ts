'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'
import { lecturaFallidaTrasEscritura } from '@/shared/lib/tras-escritura'

import { otorgarImagenNinoSchema, type OtorgarImagenNinoInput } from '../schemas/imagen'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * El tutor LEGAL vuelve a autorizar la imagen de SU hijo desde el portal de familia
 * (tras haberla revocado, o si nunca la dio).
 *
 * Reutiliza `otorgar_consentimiento_imagen` (IU-0): el consentimiento queda a nombre de
 * quien llama (la RPC fuerza `p_tutor = auth.uid()` a un no-admin) y el trigger derivador
 * recalcula `puede_aparecer_en_fotos` → las fotos conservadas vuelven a verse. La foto de
 * perfil borrada al revocar NO vuelve (se borró de verdad).
 *
 * Solo el tutor legal (`es_tutor_legal_de`), nunca un vínculo `autorizado` ni Dirección
 * desde aquí. Si ya tiene un consentimiento vigente para ese niño no se duplica.
 *
 * Devuelve `visible`: con doble consentimiento (`requiere_ambos_firmantes`) el niño sigue
 * oculto hasta que autorice también el otro tutor principal. `null`: autorizado, pero no se pudo leer
 * si ya se ve (censo C): no se dice «falta el otro tutor» sin saberlo.
 */
export async function otorgarImagenNino(
  input: OtorgarImagenNinoInput
): Promise<ActionResult<{ visible: boolean | null }>> {
  const parsed = otorgarImagenNinoSchema.safeParse(input)
  if (!parsed.success) return fail('nino.imagen.errors.fallo_otorgar')
  const ninoId = parsed.data.nino_id

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('nino.imagen.errors.no_autorizado_otorgar')

  const { data: esTutorLegal, error: errTutor } = await supabase.rpc('es_tutor_legal_de', {
    p_nino_id: ninoId,
  })
  // Censo C: sin saber si es tutor legal no se le dice «no autorizado».
  if (errTutor) return fail('common.lectura_fallida')
  if (!esTutorLegal) return fail('nino.imagen.errors.no_autorizado_otorgar')

  // ¿Ya tiene uno vigente? (RLS: cada usuario ve sus propios consentimientos.)
  const { data: vigente, error: errVigente } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('nino_id', ninoId)
    .eq('tipo', 'imagen')
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  // Censo C: sin saber si ya tiene uno, no se otorga otro encima.
  if (errVigente) return fail('common.lectura_fallida')

  if (!vigente) {
    const { ip, userAgent } = await getRequestContext()
    const { error } = await supabase.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: ninoId,
      p_tutor: user.id,
      p_version: CONSENT_VERSIONS.imagen,
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
      p_metodo: 'checkbox',
    })
    if (error) {
      logger.warn('otorgarImagenNino: otorgar', error.message)
      if (error.code === '42501') return fail('nino.imagen.errors.no_autorizado_otorgar')
      return fail('nino.imagen.errors.fallo_otorgar')
    }
  }

  const { data: nino, error: errNino } = await supabase
    .from('ninos')
    .select('puede_aparecer_en_fotos')
    .eq('id', ninoId)
    .maybeSingle()
  // El consentimiento ya está dado: no se para, y no se dice «falta el otro tutor» sin saberlo.
  if (errNino) lecturaFallidaTrasEscritura('otorgarImagenNino: ¿ya se ve?', errNino)

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/family/autorizaciones/[id]', 'page')
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return ok({ visible: errNino ? null : nino?.puede_aparecer_en_fotos === true })
}
