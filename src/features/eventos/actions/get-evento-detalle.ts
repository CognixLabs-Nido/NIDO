'use server'

import { getEventoDetalle } from '../queries/get-evento-detalle'
import type { EventoDetalle } from '../types'

/**
 * Wrapper `'use server'` para que el detalle (roster + confirmación) se cargue
 * bajo demanda desde el diálogo cliente, sin `useEffect` + fetch (convención).
 * Hereda la RLS del usuario autenticado.
 */
export async function getEventoDetalleAction(eventoId: string): Promise<EventoDetalle | null> {
  return getEventoDetalle(eventoId)
}
