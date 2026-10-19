import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import { tieneRolesVivos } from '@/features/centros/contexto/roles-de-otros'
import type { Database } from '@/types/database'

type ServiceClient = SupabaseClient<Database>

export interface CuentaDetectada {
  /** ¿Hay fila en `auth.users` con ese email (no borrada)? */
  authUserExiste: boolean
  /** ¿Esa cuenta tiene algún rol activo? Señal de cuenta REAL, no de un stub de invitación. */
  tieneRoles: boolean
}

/**
 * ¿El email tiene cuenta, y es una cuenta real (con roles) o un stub de `inviteUserByEmail`?
 *
 * Va por la RPC `buscar_auth_user_por_email` (búsqueda EXACTA en `auth.users`, solo
 * `service_role`), como el resto de flujos de alta desde el FIX B. Sustituye a
 * `listUsers()` sin paginar, que solo veía la 1.ª página (50 cuentas): con más, una cuenta
 * existente «no existía» y la invitación caía en el formulario de alta en vez de en B8.
 *
 * Con `.maybeSingle()` la AUSENCIA de cuenta llega como `data: null` sin error, así que un
 * error aquí es un fallo real del servicio: devuelve `null` y quien llama no debe suponer
 * que la cuenta no existe. Lo mismo si falla la lectura de roles.
 */
export async function detectarCuentaPorEmail(
  service: ServiceClient,
  email: string
): Promise<CuentaDetectada | null> {
  const { data: authUser, error: buscarErr } = await service
    .rpc('buscar_auth_user_por_email', { p_email: email })
    .maybeSingle()
  if (buscarErr) {
    logger.warn('detectarCuentaPorEmail buscar_auth_user_por_email', buscarErr.message)
    return null
  }
  if (!authUser) return { authUserExiste: false, tieneRoles: false }

  const tieneRoles = await tieneRolesVivos(service, authUser.id)
  if (tieneRoles === null) {
    logger.warn('detectarCuentaPorEmail roles_usuario', 'la lectura de roles falló')
    return null
  }
  return { authUserExiste: true, tieneRoles }
}
