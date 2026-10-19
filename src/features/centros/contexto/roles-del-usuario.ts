import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { centrosDelUsuario, type CentroDelUsuario } from './resolver'

/**
 * Los roles de un usuario, con el cliente y el usuario que pasa quien llama (multicentro · Fase 1).
 *
 * Es la única lectura de `roles_usuario` del usuario actual fuera de las páginas: la usan
 * `get-contexto-centro.ts` (con el cliente de la sesión) y los núcleos de las acciones, que reciben
 * el cliente inyectado para poder probarse contra la BD. Ninguna función de aquí elige un centro:
 * todas reciben el centro EXPLÍCITO o devuelven la lista entera.
 *
 * `null` = la lectura falló. Quien llama decide si eso es «no autorizado» o un error que contar.
 */

type Client = SupabaseClient<Database>

/** Los centros del usuario con sus roles activos, ordenados por id. `null` si la lectura falla. */
export async function leerCentrosDe(
  supabase: Client,
  usuarioId: string
): Promise<CentroDelUsuario[] | null> {
  const { data, error } = await supabase
    .from('roles_usuario')
    .select('centro_id, rol')
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
  if (error) return null
  return centrosDelUsuario(data ?? [])
}

/** El usuario en ese centro (rol principal y todos sus roles), o `null` si no tiene rol en él. */
export async function rolesEnCentro(
  supabase: Client,
  usuarioId: string,
  centroId: string
): Promise<CentroDelUsuario | null> {
  const centros = await leerCentrosDe(supabase, usuarioId)
  return centros?.find((c) => c.centroId === centroId) ?? null
}

/** ¿Es admin en ese centro? Un fallo de lectura cuenta como «no». */
export async function esAdminEn(
  supabase: Client,
  usuarioId: string,
  centroId: string
): Promise<boolean> {
  return (await rolesEnCentro(supabase, usuarioId, centroId))?.roles.includes('admin') ?? false
}

/** Los centros donde es admin, ordenados por id. `null` si la lectura falla. */
export async function centrosDondeEsAdmin(
  supabase: Client,
  usuarioId: string
): Promise<string[] | null> {
  const centros = await leerCentrosDe(supabase, usuarioId)
  if (!centros) return null
  return centros.filter((c) => c.roles.includes('admin')).map((c) => c.centroId)
}
