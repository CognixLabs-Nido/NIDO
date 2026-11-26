'use server'

import { contadorNoLeido } from '@/shared/lib/frontera-lectura'

import { contarInvitacionesPendientes } from '../queries/contar-invitaciones-pendientes'

/**
 * Server action wrapper sobre `contarInvitacionesPendientes()` para que el
 * `AgendaBadge` (Client Component) pueda recalcular el contador (la query es
 * `server-only` y no se importa desde el cliente). Mismo patrón que
 * `getRecordatoriosPendientesCountAction`.
 */
export async function getInvitacionesPendientesCountAction(
  centroId: string
): Promise<{ total: number | null }> {
  try {
    const total = await contarInvitacionesPendientes(centroId)
    return { total }
  } catch (e) {
    return contadorNoLeido(e)
  }
}
