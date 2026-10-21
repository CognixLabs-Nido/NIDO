import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * Las escrituras de `roles_usuario` (multicentro · Fase 1, PR6). Las hace solo la aceptación de
 * una invitación, con service role: dar el rol que trae la invitación (por la RPC que aplica la
 * tabla de motivos) y, si el alta falla después, quitárselo a la cuenta recién creada. El guard
 * prohíbe tocar `roles_usuario` fuera de `features/centros/contexto/`.
 */

type Client = SupabaseClient<Database>
type Rol = Database['public']['Enums']['user_role']

/**
 * Los motivos por los que una fila retirada NO vuelve por una invitación o un alta (la tabla de
 * motivos vive en la BD, `privado.decision_ante_retirada`; esto solo lee su respuesta): el olvido
 * no se deshace, y la baja temporal se reactiva desde Personal. La BD los da con 55000 y el motivo
 * en el HINT.
 */
export type MotivoQueNoVuelve = 'solicitud_olvido' | 'baja_temporal'

/** El motivo de un 55000 de `privado.dar_rol` / `privado.dar_vinculo`, o `null` si es otro error. */
export function motivoQueNoVuelve(
  error: { code?: string; hint?: string | null } | null
): MotivoQueNoVuelve | null {
  if (error?.code !== '55000') return null
  return error.hint === 'solicitud_olvido' || error.hint === 'baja_temporal' ? error.hint : null
}

/**
 * ¿Puede volver esta persona con este rol? Lo mira ANTES de tocar nada quien acepta una
 * invitación, con la misma tabla de motivos que luego la da (`dar_rol_de_invitacion` sin
 * escribir). `motivo` = por qué no vuelve; `error` = la comprobación falló por otra cosa.
 */
export async function motivoQueImpideElRol(
  service: Client,
  fila: { usuario_id: string; centro_id: string; rol: Rol }
): Promise<{ motivo: MotivoQueNoVuelve | null; error: boolean }> {
  const { error } = await service.rpc('dar_rol_de_invitacion', {
    p_usuario_id: fila.usuario_id,
    p_centro_id: fila.centro_id,
    p_rol: fila.rol,
    p_solo_comprobar: true,
  })
  if (!error) return { motivo: null, error: false }
  const motivo = motivoQueNoVuelve(error)
  return motivo ? { motivo, error: false } : { motivo: null, error: true }
}

/**
 * Da el rol de una invitación en su centro, por la tabla de motivos de la BD: con el rol vivo no
 * hace nada; si no, reactiva la última fila retirada o crea una nueva según su motivo, o falla
 * (55000) si es de los que no vuelven.
 */
export async function asignarRolDeInvitacion(
  service: Client,
  fila: { usuario_id: string; centro_id: string; rol: Rol }
): Promise<{ error: { code?: string; message: string; hint?: string | null } | null }> {
  const { error } = await service.rpc('dar_rol_de_invitacion', {
    p_usuario_id: fila.usuario_id,
    p_centro_id: fila.centro_id,
    p_rol: fila.rol,
  })
  return { error }
}

/**
 * Vuelta atrás de un alta a medias: borra los roles de una cuenta que se acaba de crear y se va a
 * borrar. Solo para eso; una baja normal es un borrado lógico con su motivo.
 */
export async function retirarRolesDeCuentaNueva(service: Client, usuarioId: string) {
  // entre-centros: la cuenta se acaba de crear y se va a borrar; no tiene roles en otro centro.
  return service.from('roles_usuario').delete().eq('usuario_id', usuarioId)
}
