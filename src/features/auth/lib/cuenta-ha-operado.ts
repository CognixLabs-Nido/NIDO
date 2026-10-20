import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type ServiceClient = SupabaseClient<Database>

/**
 * ¿La cuenta ha operado alguna vez? Tuvo un rol (vivo o retirado) o es superusuario
 * (`cuenta_ha_operado`, solo `service_role`). Una cuenta así NO es un alta a medias aunque hoy
 * no tenga roles vivos: quien perdió su rol o el superusuario (ADR-0061). Aceptar una invitación
 * nunca le fija la contraseña; entra con la suya, como cualquier cuenta real.
 *
 * `null` = la lectura falló; quien llama no debe suponer que no ha operado.
 */
export async function cuentaHaOperado(
  service: ServiceClient,
  usuarioId: string
): Promise<boolean | null> {
  const { data, error } = await service.rpc('cuenta_ha_operado', { p_usuario_id: usuarioId })
  if (error) return null
  return data === true
}
