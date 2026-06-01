'use server'

import { contarRecordatoriosPendientes } from '../queries/contar-pendientes'

/**
 * Server action wrapper sobre `contarRecordatoriosPendientes()` para que el
 * `RecordatoriosBadge` (Client Component) pueda recalcular el contador (la
 * query es `server-only` y no se importa desde el cliente). Mismo patrón que
 * `getUnreadCountsAction` de mensajería.
 */
export async function getRecordatoriosPendientesCountAction(): Promise<{ total: number }> {
  const total = await contarRecordatoriosPendientes()
  return { total }
}
