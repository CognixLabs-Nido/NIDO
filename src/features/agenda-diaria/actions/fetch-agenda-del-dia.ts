'use server'

import { getAgendaDelDia } from '../queries/get-agenda-del-dia'
import type { AgendaCompleta } from '../types'

/**
 * Wrapper server action del query `getAgendaDelDia` para que pueda
 * invocarse desde Client Components (al expandir la tarjeta del niño).
 * La RLS filtra: si el cliente no puede ver la agenda, devuelve la
 * estructura con cabecera null y arrays vacíos.
 */
export async function fetchAgendaDelDia(ninoId: string, fecha: string): Promise<AgendaCompleta> {
  return getAgendaDelDia(ninoId, fecha)
}
