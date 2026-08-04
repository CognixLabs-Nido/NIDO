'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'

import { esAdminDeCentroDeNino } from '../lib/authz-tutor'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3b-2a — el TUTOR registra su acuse dentro del wizard de alta. Hoy solo
 * `datos_medicos`, que desde F11-F es un ACUSE de confidencialidad (v2.0): no gatea
 * la escritura médica (voluntaria), pero es obligatorio para cerrar el alta (backstop
 * en `marcar_matricula_lista`). El consentimiento de `imagen` NO se otorga aquí: se
 * materializa al FIRMAR la autorización de imagen (trigger `firma_imagen_sync_trg`).
 */
const registrarConsentimientoTutorSchema = z.object({
  tipo: z.literal('datos_medicos'),
  // PR-3b-2 · B2: niño del alta, para RE-DERIVAR server-side si quien acusa es la
  // Dirección (respaldo en papel). No cambia a quién se atribuye el acuse.
  // U-3: además se PERSISTE (`consentimientos.nino_id`) → el acuse es POR NIÑO.
  nino_id: z.string().uuid(),
})

export type RegistrarConsentimientoTutorInput = z.infer<typeof registrarConsentimientoTutorSchema>

/**
 * Auto-consentimiento: SIEMPRE `p_usuario_id = auth.uid()` (hardcodeado; nunca se
 * acepta un `usuario_id` del cliente → nada de consentir por terceros). La RPC
 * `registrar_consentimiento` además blinda esto a nivel BD (`RAISE` si
 * `auth.uid() <> p_usuario_id`), así que la action es defensa en profundidad sobre
 * una frontera que la base de datos ya garantiza.
 *
 * PR-3b-2 · B2: el acuse médico se atribuye a `auth.uid()` — que en modo Dirección ES
 * la Directora (el backstop de `marcar_matricula_lista` exige el acuse de quien finaliza,
 * = la admin). Si el firmante es la admin del centro del niño (sin vínculo), el acuse se
 * marca `p_metodo='presencial'` (respaldo en papel); el tutor digital sigue en 'digital'.
 * `modoDireccion` se RE-DERIVA server-side con `esAdminDeCentroDeNino` (nunca del cliente).
 *
 * U-3: el acuse se ancla al NIÑO (`p_nino_id`). Antes se insertaba con `nino_id = NULL` y el
 * gate de completitud lo leía solo por `usuario_id`, de modo que el acuse del 1.er hijo daba
 * por hecho el bloque médico del 2.º. Ahora cada hijo exige el suyo (`finalizarAlta` filtra
 * por `nino_id`). El alcance del acuse no cambia (mismos datos, misma versión v2.0): cambia
 * a QUÉ alta pertenece la fila.
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

  const esDireccion = await esAdminDeCentroDeNino(supabase, parsed.data.nino_id, user.id)

  const { data, error } = await supabase.rpc('registrar_consentimiento', {
    p_usuario_id: user.id,
    p_tipo: parsed.data.tipo,
    p_version: CONSENT_VERSIONS[parsed.data.tipo],
    p_metodo: esDireccion ? 'presencial' : 'digital',
    p_nino_id: parsed.data.nino_id,
  })
  if (error || !data) {
    logger.warn('registrarConsentimientoTutor', error?.message)
    return fail('alta.errors.consentimiento_fallo')
  }

  return ok({ id: data as string })
}
