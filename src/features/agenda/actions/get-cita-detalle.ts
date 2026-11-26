'use server'

import { falloDeLectura } from '@/shared/lib/frontera-lectura'

import { getCitaDetalle } from '../queries/get-cita-detalle'
import { ok, type ActionResult, type CitaDetalle } from '../types'

/**
 * Wrapper `'use server'` para cargar el detalle de una cita (info + roster)
 * bajo demanda desde el diálogo cliente al pulsar una cita, sin `useEffect` +
 * fetch (convención). Hereda la RLS del usuario: organizador/admin reciben el
 * roster completo; un invitado, solo su propia fila (roster privado, AG-12).
 */
// Censo C (2026-11-25): una acción no deja escapar una lectura fallida (patrón Result). `null` sigue
// siendo «no existe o no la ves»; «no se ha podido leer» es su propio error.
export async function getCitaDetalleAction(
  citaId: string
): Promise<ActionResult<CitaDetalle | null>> {
  try {
    return ok(await getCitaDetalle(citaId))
  } catch (e) {
    return falloDeLectura(e)
  }
}
