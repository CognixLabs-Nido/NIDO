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

/**
 * Las bajas de Dirección que deshace una invitación nueva: quien dejó la dirección y vuelve a ser
 * invitada recupera su fila. `UNIQUE (usuario_id, centro_id, rol)` cuenta también las retiradas,
 * así que el INSERT da 23505 y, sin esto, la aceptación lo daba por bueno y la persona entraba sin
 * rol. Las bajas por otros motivos (familia, RGPD, superusuario) no se deshacen aquí.
 */
const MOTIVOS_QUE_DESHACE_UNA_INVITACION: Database['public']['Enums']['motivo_borrado'][] = [
  'baja_direccion',
  'traspaso_admin',
]

/**
 * Da el rol de una invitación en su centro. Si la persona ya tuvo ese rol y lo dejó por una baja
 * de Dirección, reactiva su fila. Si no, devuelve el error tal cual (el 23505 lo trata quien llama).
 */
export async function asignarRolDeInvitacion(
  service: Client,
  fila: { usuario_id: string; centro_id: string; rol: Rol }
): Promise<{ error: { code?: string; message: string } | null }> {
  const insertado = await service.from('roles_usuario').insert(fila)
  if (insertado.error?.code !== '23505') return insertado
  const { data, error } = await service
    .from('roles_usuario')
    .update({ deleted_at: null, deleted_reason: null })
    .eq('usuario_id', fila.usuario_id)
    .eq('centro_id', fila.centro_id)
    .eq('rol', fila.rol)
    .in('deleted_reason', MOTIVOS_QUE_DESHACE_UNA_INVITACION)
    .select('id')
    .maybeSingle()
  if (error) return { error }
  return data ? { error: null } : insertado
}

/**
 * Vuelta atrás de un alta a medias: borra los roles de una cuenta que se acaba de crear y se va a
 * borrar. Solo para eso; una baja normal es un borrado lógico con su motivo.
 */
export async function retirarRolesDeCuentaNueva(service: Client, usuarioId: string) {
  return service.from('roles_usuario').delete().eq('usuario_id', usuarioId)
}
