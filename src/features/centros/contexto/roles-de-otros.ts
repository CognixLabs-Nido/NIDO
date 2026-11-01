import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { columnasDe, type FilaDe } from '@/features/export/lib/columnas-recolectar'

import { rolDeLaApp, type Rol } from './resolver'

/**
 * Las lecturas de `roles_usuario` que NO son «el centro del usuario actual»: miran a OTRO usuario
 * o a un centro explícito (multicentro · Fase 1, PR6). Antes vivían sueltas en 14 ficheros con una
 * lista de excepciones en el guard; ahora cada motivo es una función con nombre, y el guard
 * prohíbe cualquier `.from('roles_usuario')` fuera de `features/centros/contexto/`.
 *
 * Ninguna elige un centro. Cada una lee con el cliente que le pasa quien llama (de sesión, con la
 * RLS delante, o service role donde la lectura ya se hacía así), y conserva lo que hacía antes
 * con un fallo de lectura: lo dice su comentario.
 */

type Client = SupabaseClient<Database>

/**
 * ¿La cuenta tiene algún rol vivo, en cualquier centro? Es la señal de cuenta OPERATIVA para
 * clasificar una cuenta ajena (una invitación a medias no cuenta). Global a propósito: la persona
 * existe aunque su rol esté en otro centro. `null` = la lectura falló; quien llama decide si eso
 * es «no» o un error que contar.
 */
export async function tieneRolesVivos(client: Client, usuarioId: string): Promise<boolean | null> {
  // entre-centros: ¿opera en algún centro? Global a propósito (lo dice el comentario de arriba).
  const { data, error } = await client
    .from('roles_usuario')
    .select('usuario_id')
    .eq('usuario_id', usuarioId)
    .is('deleted_at', null)
    .limit(1)
  if (error) return null
  return (data?.length ?? 0) > 0
}

/** Cuántos roles vivos hay en un centro explícito (el resumen del inicio de Dirección). */
export async function contarRolesDelCentro(client: Client, centroId: string): Promise<number> {
  const { count } = await client
    .from('roles_usuario')
    .select('usuario_id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  return count ?? 0
}

/**
 * Todos los roles del sujeto de un export (art. 15), vivos y borrados. Con el cliente de quien
 * exporta: la RLS decide qué filas ve. Pide las columnas que decide la red del export
 * (`columnas-recolectar.ts`, `usuario.roles`), y un fallo de lectura rompe el export: con las
 * columnas una a una, una que ya no está en la base da error, y una lista vacía lo callaría.
 */
export async function rolesDelSujetoParaExport(
  client: Client,
  usuarioId: string
): Promise<FilaDe<'usuario.roles'>[]> {
  // entre-centros: el export del sujeto (art. 15), con lo que la sesión de quien exporta alcanza.
  const { data, error } = await client
    .from('roles_usuario')
    .select(columnasDe('usuario.roles'))
    .eq('usuario_id', usuarioId)
  if (error) throw new Error(`export: la lectura de usuario.roles falló: ${error.message}`)
  return (data ?? []) as unknown as FilaDe<'usuario.roles'>[]
}

/**
 * Los roles vivos de los autores de una conversación en su centro (para la etiqueta de cada
 * mensaje), como roles de la app: la directora sale como `admin`, Dirección en pantalla. Del
 * centro de la conversación: quien es profe aquí y tutora en otro centro sale como profe.
 */
export async function rolesDeAutores(
  client: Client,
  autorIds: string[],
  centroId: string
): Promise<Array<{ usuario_id: string; rol: Rol }>> {
  if (autorIds.length === 0) return []
  const { data } = await client
    .from('roles_usuario')
    .select('usuario_id, rol')
    .eq('centro_id', centroId)
    .in('usuario_id', autorIds)
    .is('deleted_at', null)
  return (data ?? []).flatMap(({ usuario_id, rol }) => {
    const deLaApp = rolDeLaApp(rol)
    return deLaApp ? [{ usuario_id, rol: deLaApp }] : []
  })
}

/** ¿Ese usuario tiene rol profe vivo en ese centro? (antes de asignarlo a un aula). */
export async function tieneRolProfeEn(
  client: Client,
  usuarioId: string,
  centroId: string
): Promise<boolean> {
  const { data } = await client
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', usuarioId)
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  return data !== null
}

/** ¿Ese usuario tiene rol familiar (tutor o autorizado) vivo en ese centro? (antes de vincularlo). */
export async function tieneRolFamiliarEn(
  client: Client,
  usuarioId: string,
  centroId: string
): Promise<boolean> {
  const { data } = await client
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', usuarioId)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .in('rol', ['tutor_legal', 'autorizado'])
    .limit(1)
    .maybeSingle()
  return data !== null
}

/** Los profes vivos de un centro explícito, con su nombre (candidatos a un aula). */
export async function profesDelCentroConNombre(client: Client, centroId: string) {
  return client
    .from('roles_usuario')
    .select('usuario:usuarios!inner(id, nombre_completo)')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)
}

/** Los ids de los profes vivos de un centro explícito (audiencias de citas y recordatorios). */
export async function profesDelCentro(client: Client, centroId: string): Promise<string[]> {
  const { data } = await client
    .from('roles_usuario')
    .select('usuario_id')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .is('deleted_at', null)
  return (data ?? []).map((r) => r.usuario_id)
}

/** Una persona de la Dirección de un centro: la admin o una directora (pantalla de Dirección). */
export interface MiembroDireccion {
  usuarioId: string
  rol: 'admin' | 'directora'
  nombre: string
}

/**
 * Quién dirige un centro explícito: la admin y las directoras vivas, con su nombre, la admin
 * primero y después por nombre. Con la sesión de quien llama (`roles_admin_select`: Dirección del
 * centro). `null` si la lectura falla: la pantalla no puede enseñar una lista vacía como si
 * nadie dirigiera el centro.
 */
export async function direccionDelCentro(
  client: Client,
  centroId: string
): Promise<MiembroDireccion[] | null> {
  const { data, error } = await client
    .from('roles_usuario')
    .select('rol, usuario:usuarios!inner(id, nombre_completo)')
    .eq('centro_id', centroId)
    .in('rol', ['admin', 'directora'])
    .is('deleted_at', null)
  if (error) return null
  return (data ?? [])
    .map((f) => ({
      usuarioId: f.usuario.id,
      rol: f.rol as MiembroDireccion['rol'],
      nombre: f.usuario.nombre_completo,
    }))
    .sort((a, b) =>
      a.rol !== b.rol ? (a.rol === 'admin' ? -1 : 1) : a.nombre.localeCompare(b.nombre, 'es')
    )
}

/** Una persona del personal del centro, por su fila `profe` (activa o de baja temporal). */
export interface MiembroPersonal {
  usuarioId: string
  nombre: string
  /** Ruta en el bucket `usuarios-fotos` (SIN firmar); null si no hay avatar. */
  fotoUrl: string | null
}

/**
 * El personal del centro según `roles_usuario`, no según sus aulas: quien tiene la fila `profe`
 * viva (`activas`, con o sin aula) y quien la tiene retirada por una baja temporal (`deBaja`, que
 * Dirección puede reactivar). Quien salió del centro no sale. Con la sesión de Dirección
 * (`roles_admin_select`). `null` = la lectura falló.
 */
export async function personalDelCentro(
  client: Client,
  centroId: string
): Promise<{ activas: MiembroPersonal[]; deBaja: MiembroPersonal[] } | null> {
  const { data, error } = await client
    .from('roles_usuario')
    .select('deleted_at, deleted_reason, usuario:usuarios!inner(id, nombre_completo, foto_url)')
    .eq('centro_id', centroId)
    .eq('rol', 'profe')
    .or('deleted_at.is.null,deleted_reason.eq.baja_temporal')
  if (error) return null
  const porNombre = (a: MiembroPersonal, b: MiembroPersonal) =>
    a.nombre.localeCompare(b.nombre, 'es')
  const miembro = (f: (typeof data)[number]): MiembroPersonal => ({
    usuarioId: f.usuario.id,
    nombre: f.usuario.nombre_completo,
    fotoUrl: f.usuario.foto_url,
  })
  return {
    activas: data
      .filter((f) => f.deleted_at === null)
      .map(miembro)
      .sort(porNombre),
    deBaja: data
      .filter((f) => f.deleted_at !== null)
      .map(miembro)
      .sort(porNombre),
  }
}

/**
 * Las titulares (fila `admin` viva) de un centro explícito: a quién avisar de una petición de
 * olvido nueva (`20261126120000`). Con el cliente de servicio de quien avisa. Un fallo de lectura
 * sale como lista vacía: el aviso es best-effort y no debe romper la petición.
 */
export async function titularesDelCentro(client: Client, centroId: string): Promise<string[]> {
  const { data, error } = await client
    .from('roles_usuario')
    .select('usuario_id')
    .eq('centro_id', centroId)
    .eq('rol', 'admin')
    .is('deleted_at', null)
  if (error) return []
  return [...new Set((data ?? []).map((r) => r.usuario_id))]
}
