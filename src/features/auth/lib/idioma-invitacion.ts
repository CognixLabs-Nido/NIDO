import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import type { IdiomaCorreo } from '../schemas/invitation'

import { llamarGoTrue } from './llamar-gotrue'

/**
 * Idioma del correo de invitación (y de la página a la que lleva su enlace). La plantilla lo lee
 * de los metadatos de la cuenta (`.Data.idioma_preferido`, ver `supabase/templates/invite.html`).
 *
 *   - Sin cuenta previa → el elegido por la Dirección, o castellano. `inviteUserByEmail` crea la
 *     cuenta provisional con esos metadatos y `handle_new_user` copia el idioma a `usuarios`.
 *   - Cuenta provisional de una invitación anterior (sin confirmar) → GoTrue REENVÍA el correo con
 *     los metadatos de ENTONCES: no aplica los que le pasa la nueva invitación. Si la Dirección
 *     eligió idioma, se actualiza aquí la cuenta (metadatos + `usuarios`) ANTES de reenviar; si no
 *     eligió (reenvío desde la lista de pendientes), se conserva el que ya tenía.
 *   - Cuenta confirmada (real) → no se toca: GoTrue rechazará la invitación (`email_exists`).
 *
 * Nunca falla la invitación: si algo de esto falla, se registra y el correo sale igualmente (en
 * el peor caso, en el idioma anterior de la cuenta provisional).
 */
export async function prepararIdiomaInvitacion(
  service: SupabaseClient<Database>,
  email: string,
  elegido: IdiomaCorreo | undefined
): Promise<IdiomaCorreo> {
  const { data: cuenta, error: buscarErr } = await service
    .rpc('buscar_auth_user_por_email', { p_email: email })
    .maybeSingle()
  if (buscarErr) logger.warn('prepararIdiomaInvitacion: buscar cuenta', buscarErr.message)
  if (!cuenta) return elegido ?? 'es'

  const { data: usuario } = await service
    .from('usuarios')
    .select('idioma_preferido')
    .eq('id', cuenta.id)
    .maybeSingle()
  const actual = (usuario?.idioma_preferido ?? 'es') as IdiomaCorreo
  if (!elegido || elegido === actual) return elegido ?? actual

  const { data: auth } = await llamarGoTrue('getUserById', () =>
    service.auth.admin.getUserById(cuenta.id)
  )
  // Cuenta real (confirmada) o no legible: no se cambia su idioma.
  if (!auth?.user || auth.user.email_confirmed_at) return elegido

  const { error: metaErr } = await llamarGoTrue('updateUserById', () =>
    service.auth.admin.updateUserById(cuenta.id, { user_metadata: { idioma_preferido: elegido } })
  )
  if (metaErr) logger.warn('prepararIdiomaInvitacion: metadatos', metaErr.message)
  const { error: usuarioErr } = await service
    .from('usuarios')
    .update({ idioma_preferido: elegido })
    .eq('id', cuenta.id)
  if (usuarioErr) logger.warn('prepararIdiomaInvitacion: usuarios', usuarioErr.message)
  return elegido
}
