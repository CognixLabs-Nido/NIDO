import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * Las escrituras de `roles_usuario` (multicentro · Fase 1, PR6). Las hace solo la aceptación de
 * una invitación, con service role: dar el rol que trae la invitación y, si el alta falla después,
 * quitárselo a la cuenta recién creada. El guard prohíbe tocar `roles_usuario` fuera de
 * `features/centros/contexto/`.
 */

type Client = SupabaseClient<Database>
type Rol = Database['public']['Enums']['user_role']

/** Da el rol de una invitación en su centro. Devuelve el error tal cual (el 23505 lo trata quien llama). */
export async function asignarRolDeInvitacion(
  service: Client,
  fila: { usuario_id: string; centro_id: string; rol: Rol }
) {
  return service.from('roles_usuario').insert(fila)
}

/**
 * Vuelta atrás de un alta a medias: borra los roles de una cuenta que se acaba de crear y se va a
 * borrar. Solo para eso; una baja normal es un borrado lógico con su motivo.
 */
export async function retirarRolesDeCuentaNueva(service: Client, usuarioId: string) {
  return service.from('roles_usuario').delete().eq('usuario_id', usuarioId)
}
