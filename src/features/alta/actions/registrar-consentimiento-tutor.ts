'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3b-2a — el TUTOR otorga su propio consentimiento dentro del wizard de alta.
 * Hoy solo `datos_medicos` (la cartilla + la ficha médica del tutor lo exigen; la RPC
 * médica y la RLS del bucket cartilla gatean por `tiene_consentimiento(...,'datos_medicos')`).
 * El consentimiento de `imagen` NO se otorga aquí: se materializa al FIRMAR la
 * autorización de imagen (trigger `firma_imagen_sync_trg`), no como checkbox.
 */
const registrarConsentimientoTutorSchema = z.object({
  tipo: z.literal('datos_medicos'),
})

export type RegistrarConsentimientoTutorInput = z.infer<typeof registrarConsentimientoTutorSchema>

/**
 * Auto-consentimiento: SIEMPRE `p_usuario_id = auth.uid()` (hardcodeado; nunca se
 * acepta un `usuario_id` del cliente → nada de consentir por terceros). La RPC
 * `registrar_consentimiento` además blinda esto a nivel BD (`RAISE` si
 * `auth.uid() <> p_usuario_id`), así que la action es defensa en profundidad sobre
 * una frontera que la base de datos ya garantiza.
 */
export async function registrarConsentimientoTutor(
  input: RegistrarConsentimientoTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = registrarConsentimientoTutorSchema.safeParse(input)
  if (!parsed.success) return fail('alta.errors.consentimiento_fallo')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { data, error } = await supabase.rpc('registrar_consentimiento', {
    p_usuario_id: user.id,
    p_tipo: parsed.data.tipo,
    p_version: CONSENT_VERSIONS[parsed.data.tipo],
  })
  if (error || !data) {
    logger.warn('registrarConsentimientoTutor', error?.message)
    return fail('alta.errors.consentimiento_fallo')
  }

  return ok({ id: data as string })
}
