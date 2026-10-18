import 'server-only'

import { contextoEnCentro, getEstadoCentro } from '../contexto/get-contexto-centro'

/**
 * @deprecated Multicentro · Fase 1. Usa `requireContextoCentro` (páginas y layouts) o
 * `contextoEnCentro` (acciones con el centro explícito), de `features/centros/contexto`.
 *
 * Se queda mientras se migran los ficheros que la importan (lista base del guard
 * `scripts/check-centro-activo.mjs`, que no deja añadir ninguno nuevo). Ya NO elige el centro con
 * `limit(1)` sin orden: delega en el contexto, así que devuelve el centro activo validado, o
 * `null` si no hay sesión o el usuario tiene varios centros y no ha elegido.
 */
export async function getCentroActualId(): Promise<string | null> {
  const estado = await getEstadoCentro()
  return estado.tipo === 'activo' ? estado.contexto.centroId : null
}

/**
 * @deprecated Multicentro · Fase 1. Usa `contextoEnCentro(centroId)?.rol`.
 *
 * El rol activo del usuario en el centro, el de más privilegios si tiene varios (admin > profe >
 * tutor_legal > autorizado), o `null` si no tiene rol en él.
 */
export async function getRolEnCentro(centroId: string): Promise<string | null> {
  return (await contextoEnCentro(centroId))?.rol ?? null
}
