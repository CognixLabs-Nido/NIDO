'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { esSuperusuario } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'

import { titularRespuestaImagen } from '../lib/titular-respuesta-imagen'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Vía B (IU-2) — el checkbox "autorizo imagen" del alta OTORGA el consentimiento de
 * imagen del niño (fuente de verdad, IU-0) vía `otorgar_consentimiento_imagen`, en vez de
 * escribir `acuses_alta` tipo 'imagen'. Así el checkbox alimenta el MISMO consent por-niño
 * que la firma (vía A) y el flag `puede_aparecer_en_fotos` se deriva solo.
 *
 * El titular lo decide `titularRespuestaImagen` (10b-2, decisión del 2026-11-18): la familia, el
 * suyo (`metodo='checkbox'`); en el alta en papel, el del tutor legal que firmó el papel, anotado por
 * Dirección (`metodo='presencial'`), nunca a nombre de la persona de Dirección. Hasta la 10b-2 iba a
 * nombre de quien tecleaba, y así quedó en producción un «sí» de Dirección sin vínculo con el niño.
 */
const otorgarImagenAltaSchema = z.object({
  nino_id: z.string().uuid(),
  /** En el alta en papel: el tutor legal que firmó el papel. La familia no lo manda. */
  tutor_id: z.string().uuid().optional(),
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

  const titular = await titularRespuestaImagen(
    supabase,
    parsed.data.nino_id,
    user.id,
    parsed.data.tutor_id
  )
  if (!titular.ok) return fail(titular.error)

  const { ip, userAgent } = await getRequestContext()
  const { error } = await supabase.rpc('otorgar_consentimiento_imagen', {
    p_nino_id: parsed.data.nino_id,
    p_tutor: titular.tutor,
    p_version: CONSENT_VERSIONS.imagen,
    p_ip: ip ?? undefined,
    p_user_agent: userAgent ?? undefined,
    p_metodo: titular.metodo,
  })
  if (error) {
    logger.warn('otorgarConsentimientoImagenAlta', error.message)
    if (error.code === '42501') {
      // El superusuario no consiente en nombre de la familia (ADR-0061): lo decide la RPC (le
      // deja solo si es tutor legal del niño); aquí solo se da el motivo.
      if (await esSuperusuario(supabase)) return fail('alta.errors.presencial_solo_direccion')
      return fail('alta.errors.no_autorizado')
    }
    return fail('alta.errors.acuse_fallo')
  }

  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  return ok({ ok: true })
}
