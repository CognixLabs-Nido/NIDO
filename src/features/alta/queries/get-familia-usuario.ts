import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface FamiliaDelUsuario {
  familiaId: string
  centroId: string
}

/**
 * F-2c-4 — resuelve la FAMILIA del usuario (tutor) logueado desde `auth.uid()`. La relación
 * es 1:1 (índice único parcial `ux_familia_tutores_usuario_unico` sobre `familia_tutores`),
 * así que un tutor pertenece a una sola familia activa. Se usa en el camino del tutor de
 * `/family/recibos` (ver mandato + registrar/sustituir domiciliación con firma digital).
 *
 * `familia_id` sale de `familia_tutores` con el cliente del USUARIO (la RLS
 * `familia_tutores_select_tutor` autoriza `es_tutor_de_familia` → el tutor lee su fila). El
 * `centro_id` se deriva con el helper `centro_de_familia` (SECURITY DEFINER, GRANT
 * authenticated): la tabla `familias` es admin-only para SELECT, así que no se puede leer
 * directamente como tutor. Devuelve `null` si el usuario no es tutor de ninguna familia.
 */
export async function familiaDelUsuarioActual(): Promise<FamiliaDelUsuario | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: fila } = await supabase
    .from('familia_tutores')
    .select('familia_id')
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!fila?.familia_id) return null

  const { data: centroId } = await supabase.rpc('centro_de_familia', {
    p_familia_id: fila.familia_id,
  })
  if (!centroId) return null

  return { familiaId: fila.familia_id, centroId }
}
