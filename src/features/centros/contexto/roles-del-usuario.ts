import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { centrosDelSuperusuario, centrosDelUsuario, type CentroDelUsuario } from './resolver'

/**
 * Los roles de un usuario, con el cliente y el usuario que pasa quien llama (multicentro · Fase 1).
 *
 * Es la única lectura de `roles_usuario` del usuario actual fuera de las páginas: la usan
 * `get-contexto-centro.ts` (con el cliente de la sesión) y los núcleos de las acciones, que reciben
 * el cliente inyectado para poder probarse contra la BD. Ninguna función de aquí elige un centro:
 * todas reciben el centro EXPLÍCITO o devuelven la lista entera.
 *
 * `null` = la lectura falló. Quien llama decide si eso es «no autorizado» o un error que contar.
 *
 * El superusuario (Fase 3, ADR-0061) no tiene filas de admin en `roles_usuario`: es admin de
 * todos los centros. `is_superadmin()` mira al usuario de la SESIÓN de `supabase`, así que estas
 * funciones son para el usuario actual (`usuarioId` = el de la sesión), como ya eran.
 */

type Client = SupabaseClient<Database>

/** ¿El usuario de la sesión es superusuario? Un fallo cuenta como «no» (nunca abre de más). */
export async function esSuperusuario(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_superadmin')
  if (error) {
    logger.warn('esSuperusuario: is_superadmin falló', { code: error.code })
    return false
  }
  return data === true
}

/**
 * Los centros del usuario con sus roles activos, ordenados por id. El superusuario tiene además
 * todos los centros que existen, como admin. `null` si alguna lectura falla.
 */
export async function leerCentrosDe(
  supabase: Client,
  usuarioId: string
): Promise<CentroDelUsuario[] | null> {
  const [{ data, error }, esSuper] = await Promise.all([
    // entre-centros: los centros del usuario, para elegir en cuál entra.
    supabase
      .from('roles_usuario')
      .select('centro_id, rol')
      .eq('usuario_id', usuarioId)
      .is('deleted_at', null),
    esSuperusuario(supabase),
  ])
  if (error) return null
  const propios = centrosDelUsuario(data ?? [])
  if (!esSuper) return propios
  // entre-centros: el superusuario es admin de todos los centros que existen.
  const { data: centros, error: errorCentros } = await supabase
    .from('centros')
    .select('id')
    .is('deleted_at', null)
  if (errorCentros) return null
  return centrosDelSuperusuario(
    propios,
    (centros ?? []).map((c) => c.id)
  )
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

/**
 * Los roles vivos del usuario en CUALQUIER centro, sin agrupar. Solo para el proxy, que gatea el
 * prefijo de ruta (`/admin`, `/teacher`…) antes de que haya contexto de centro. El superusuario
 * suma `admin` (Fase 3): pasa a `/admin`, y la página le pide elegir centro.
 * Un fallo de lectura es lista vacía (el proxy manda a `/forbidden`), como antes.
 */
export async function rolesEnCualquierCentro(
  supabase: Client,
  usuarioId: string
): Promise<Database['public']['Enums']['user_role'][]> {
  const [{ data }, esSuper] = await Promise.all([
    // entre-centros: el proxy gatea la ruta antes de que haya centro (lo dice el comentario).
    supabase.from('roles_usuario').select('rol').eq('usuario_id', usuarioId).is('deleted_at', null),
    esSuperusuario(supabase),
  ])
  const roles = (data ?? []).map((r) => r.rol)
  return esSuper && !roles.includes('admin') ? [...roles, 'admin'] : roles
}

/**
 * ¿Es Dirección en ese centro (la admin o una directora, como `es_admin`)? Un fallo de lectura
 * cuenta como «no». Para lo exclusivo de la admin, `esResponsableEn`.
 */
export async function esAdminEn(
  supabase: Client,
  usuarioId: string,
  centroId: string
): Promise<boolean> {
  return (await rolesEnCentro(supabase, usuarioId, centroId))?.roles.includes('admin') ?? false
}

/**
 * ¿Es la admin de ese centro, o el superusuario (como `privado.es_responsable`)? Lo exclusivo de
 * la admin: los datos y el logo del centro, las cuotas, los datos de acreedor, las plantillas
 * legales, cerrar el curso, la auditoría, los derechos RGPD y nombrar admins o directoras. Un
 * fallo de lectura cuenta como «no».
 */
export async function esResponsableEn(
  supabase: Client,
  usuarioId: string,
  centroId: string
): Promise<boolean> {
  return (await rolesEnCentro(supabase, usuarioId, centroId))?.esResponsable ?? false
}

/** Los centros donde es Dirección, ordenados por id. `null` si la lectura falla. */
export async function centrosDondeEsAdmin(
  supabase: Client,
  usuarioId: string
): Promise<string[] | null> {
  const centros = await leerCentrosDe(supabase, usuarioId)
  if (!centros) return null
  return centros.filter((c) => c.roles.includes('admin')).map((c) => c.centroId)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El usuario de la sesión de `supabase`, si es Dirección en ese centro (explícito: de la página o
 * del registro que se toca). `null` si no hay sesión, el id no es un uuid, la lectura falla o no
 * es Dirección allí. Para las acciones de Dirección; la RLS o la RPC siguen autorizando la
 * escritura.
 */
export async function usuarioAdminEn(supabase: Client, centroId: string): Promise<string | null> {
  return usuarioDeLaSesionSi(supabase, centroId, esAdminEn)
}

/**
 * Como `usuarioAdminEn`, para lo exclusivo de la admin: el usuario de la sesión si es la admin de
 * ese centro o el superusuario (`esResponsableEn`). Una directora recibe `null`.
 */
export async function usuarioResponsableEn(
  supabase: Client,
  centroId: string
): Promise<string | null> {
  return usuarioDeLaSesionSi(supabase, centroId, esResponsableEn)
}

async function usuarioDeLaSesionSi(
  supabase: Client,
  centroId: string,
  comprobar: (supabase: Client, usuarioId: string, centroId: string) => Promise<boolean>
): Promise<string | null> {
  if (!UUID.test(centroId)) return null
  const { data } = await supabase.auth.getUser()
  const usuarioId = data.user?.id
  if (!usuarioId) return null
  return (await comprobar(supabase, usuarioId, centroId)) ? usuarioId : null
}
