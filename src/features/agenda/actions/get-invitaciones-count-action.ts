'use server'

import { contarInvitacionesPendientes } from '../queries/contar-invitaciones-pendientes'

/**
 * Server action wrapper sobre `contarInvitacionesPendientes()` para que el
 * `AgendaBadge` (Client Component) pueda recalcular el contador (la query es
 * `server-only` y no se importa desde el cliente). Mismo patrón que
 * `getRecordatoriosPendientesCountAction`.
 */
export async function getInvitacionesPendientesCountAction(): Promise<{ total: number }> {
  const total = await contarInvitacionesPendientes()
  return { total }
}
