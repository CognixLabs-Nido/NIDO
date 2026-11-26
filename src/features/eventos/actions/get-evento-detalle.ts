'use server'

import { falloDeLectura } from '@/shared/lib/frontera-lectura'

import { getEventoDetalle } from '../queries/get-evento-detalle'
import { ok, type ActionResult, type EventoDetalle } from '../types'

/**
 * Wrapper `'use server'` para que el detalle (roster + confirmación) se cargue
 * bajo demanda desde el diálogo cliente, sin `useEffect` + fetch (convención).
 * Hereda la RLS del usuario autenticado.
 */
// Censo C (2026-11-25): una acción no deja escapar una lectura fallida (patrón Result). `null` sigue
// siendo «no existe o no la ves»; «no se ha podido leer» es su propio error.
export async function getEventoDetalleAction(
  eventoId: string
): Promise<ActionResult<EventoDetalle | null>> {
  try {
    return ok(await getEventoDetalle(eventoId))
  } catch (e) {
    return falloDeLectura(e)
  }
}
