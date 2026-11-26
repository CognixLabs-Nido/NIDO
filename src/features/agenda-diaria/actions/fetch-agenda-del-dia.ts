'use server'

import { oNoLeido } from '@/shared/lib/en-seccion'

import { getAgendaDelDia } from '../queries/get-agenda-del-dia'
import type { AgendaCompleta } from '../types'

/**
 * Wrapper server action del query `getAgendaDelDia` para que pueda
 * invocarse desde Client Components (al expandir la tarjeta del niño).
 * La RLS filtra: si el cliente no puede ver la agenda, devuelve la
 * estructura con cabecera null y arrays vacíos. `null`: no se pudo leer (censo C). La tarjeta lo dice en
 * su sitio, con «Reintentar», en vez de enseñar la agenda vacía con los formularios en blanco: guardar
 * ahí pisaría lo que no se leyó.
 */
export async function fetchAgendaDelDia(
  ninoId: string,
  fecha: string
): Promise<AgendaCompleta | null> {
  return oNoLeido(getAgendaDelDia(ninoId, fecha), 'agenda del aula: agenda del niño')
}
