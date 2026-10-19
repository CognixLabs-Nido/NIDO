'use server'

import { countNoLeidos } from '../queries/count-no-leidos'

/**
 * Server action wrapper sobre `countNoLeidos()` para que el badge
 * pueda recalcular el contador desde un Client Component (la query
 * usa `server-only` y no se puede importar directamente desde el cliente).
 */
export async function getUnreadCountsAction(centroId: string): Promise<{ total: number }> {
  // El centro llega del badge (el de la página). `countNoLeidos` comprueba el rol en él; un centro
  // ajeno solo da el conteo sin rol admin, que la RLS ya acota a lo que el usuario puede leer.
  const counts = await countNoLeidos(centroId)
  return { total: counts.total }
}
