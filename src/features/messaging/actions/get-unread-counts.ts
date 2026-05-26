'use server'

import { countNoLeidos } from '../queries/count-no-leidos'

/**
 * Server action wrapper sobre `countNoLeidos()` para que el badge
 * pueda recalcular el contador desde un Client Component (la query
 * usa `server-only` y no se puede importar directamente desde el cliente).
 */
export async function getUnreadCountsAction(): Promise<{ total: number }> {
  const counts = await countNoLeidos()
  return { total: counts.total }
}
