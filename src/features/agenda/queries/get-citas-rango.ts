import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { CitaAgenda, RsvpEstado } from '../types'

/**
 * Citas del rango `[desde, hasta]` (fechas 'YYYY-MM-DD') visibles para el usuario
 * (RLS: organizador o invitado). Ordenadas por fecha y hora. Incluye `mi_estado`
 * (RSVP del usuario si es invitado) y `es_organizador`. La lista de invitados
 * embebida la filtra la RLS: un invitado solo recibe su propia fila.
 */
export async function getCitasRango(desde: string, hasta: string): Promise<CitaAgenda[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  const { data, error } = await supabase
    .from('citas')
    .select(
      'id, tipo, titulo, descripcion, lugar, fecha, hora_inicio, hora_fin, estado, aula_id, nino_id, organizador_id, cita_invitados(usuario_id, estado)'
    )
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })

  if (error) {
    logger.warn('getCitasRango', error.message)
    return []
  }

  return (data ?? []).map((c) => {
    const invitados = (c.cita_invitados ?? []) as {
      usuario_id: string | null
      estado: RsvpEstado
    }[]
    const miFila = invitados.find((i) => i.usuario_id === userId)
    return {
      id: c.id,
      tipo: c.tipo,
      titulo: c.titulo,
      descripcion: c.descripcion,
      lugar: c.lugar,
      fecha: c.fecha,
      hora_inicio: c.hora_inicio,
      hora_fin: c.hora_fin,
      estado: c.estado,
      aula_id: c.aula_id,
      nino_id: c.nino_id,
      es_organizador: c.organizador_id === userId,
      mi_estado: miFila?.estado ?? null,
    }
  })
}
