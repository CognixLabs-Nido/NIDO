import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { retirarRolesDeCuentaNueva } from '@/features/centros/contexto/escribir-roles'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

type Service = SupabaseClient<Database>

/** Un bloqueo que no caduca en la práctica (100 años): la cuenta no entra hasta que alguien la mire. */
const BLOQUEO = '876000h'

/** Lo que queda de una cuenta nueva que se intentó deshacer. */
export type CuentaDeshecha = 'borrada' | 'bloqueada' | 'a_medias'

/**
 * Deshace la cuenta que un alta acaba de crear cuando algo de después falla (B2, decisión de Jose del
 * 2026-11-27). Medido abierto antes: el agujero no era el borrado de los roles, era el `deleteUser`
 * tragado con `.catch(() => {})`. Con él fallando, la acción contestaba «create_failed» y la cuenta
 * existía, con su rol de profe, y entraba. Bloquearla en Auth es lo que cierra el peor caso.
 *
 *   1. `deleteUser`, mirado. Si va bien, no queda nada: el borrado arrastra sus roles (medido).
 *   2. Si falla: se retiran sus roles (mirado) y se bloquea la cuenta en Auth (mirado), para que no
 *      entre aunque exista.
 *   3. Lo que quede a medias va a Sentry con lo que pasó (sin datos personales: el id de la cuenta).
 *
 * Nunca lanza: quien llama ya está devolviendo un error.
 */
export async function deshacerCuentaNueva(
  service: Service,
  usuarioId: string,
  donde: string
): Promise<CuentaDeshecha> {
  const borrar = await service.auth.admin
    .deleteUser(usuarioId)
    .catch((e: unknown) => ({ error: { message: e instanceof Error ? e.message : 'lanzó' } }))
  if (!borrar.error) return 'borrada'

  const roles = await Promise.resolve(retirarRolesDeCuentaNueva(service, usuarioId)).catch(
    (e: unknown) => ({ error: { message: e instanceof Error ? e.message : 'lanzó' } })
  )
  const bloqueo = await service.auth.admin
    .updateUserById(usuarioId, { ban_duration: BLOQUEO })
    .catch((e: unknown) => ({ error: { message: e instanceof Error ? e.message : 'lanzó' } }))

  const queda: CuentaDeshecha = bloqueo.error ? 'a_medias' : 'bloqueada'
  logger.error(`cuenta nueva sin deshacer (${donde})`, {
    usuario_id: usuarioId,
    borrada: false,
    roles_retirados: !roles.error,
    bloqueada: !bloqueo.error,
    queda,
  })
  return queda
}
