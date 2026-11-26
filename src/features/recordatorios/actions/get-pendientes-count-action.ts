'use server'

import { contadorNoLeido } from '@/shared/lib/frontera-lectura'

import { contarRecordatoriosPendientes } from '../queries/contar-pendientes'

/**
 * Server action wrapper sobre `contarRecordatoriosPendientes()` para que el
 * `RecordatoriosBadge` (Client Component) pueda recalcular el contador (la
 * query es `server-only` y no se importa desde el cliente). Mismo patrón que
 * `getUnreadCountsAction` de mensajería.
 */
export async function getRecordatoriosPendientesCountAction(
  centroId: string
): Promise<{ total: number | null }> {
  // El centro llega del badge. La RPC solo cuenta lo del propio usuario (auth.uid()), así que
  // otro centro no enseña nada ajeno: como mucho, 0. Con la lectura caída, «?» (censo C).
  try {
    const total = await contarRecordatoriosPendientes(centroId)
    return { total }
  } catch (e) {
    return contadorNoLeido(e)
  }
}
