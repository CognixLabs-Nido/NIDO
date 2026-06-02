'use server'

import { getCitaDetalle } from '../queries/get-cita-detalle'
import type { CitaDetalle } from '../types'

/**
 * Wrapper `'use server'` para cargar el detalle de una cita (info + roster)
 * bajo demanda desde el diálogo cliente al pulsar una cita, sin `useEffect` +
 * fetch (convención). Hereda la RLS del usuario: organizador/admin reciben el
 * roster completo; un invitado, solo su propia fila (roster privado, AG-12).
 */
export async function getCitaDetalleAction(citaId: string): Promise<CitaDetalle | null> {
  return getCitaDetalle(citaId)
}
