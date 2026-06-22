import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { CitaDetalle, InvitadoRoster, RsvpEstado } from '../types'

/**
 * Detalle de una cita + su roster, filtrado por RLS:
 *  - organizador/admin → roster completo;
 *  - invitado          → solo su propia fila (roster privado, AG-12).
 *
 * Los nombres de los invitados internos se resuelven con **service role** (solo
 * display, sobre los invitados que el llamante ya puede ver por RLS — sin fuga
 * de autorización). Devuelve `null` si la cita no es visible para el usuario.
 */
export async function getCitaDetalle(citaId: string): Promise<CitaDetalle | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: cita, error } = await supabase
    .from('citas')
    .select(
      'id, tipo, titulo, descripcion, lugar, fecha, hora_inicio, hora_fin, estado, aula_id, nino_id, organizador_id'
    )
    .eq('id', citaId)
    .maybeSingle()
  if (error) {
    logger.warn('getCitaDetalle: cita', error.message)
    return null
  }
  if (!cita) return null

  const { data: invitados, error: invErr } = await supabase
    .from('cita_invitados')
    .select('id, usuario_id, nombre_externo, estado, respondido_at, comentario')
    .eq('cita_id', citaId)
    .order('created_at', { ascending: true })
  if (invErr) {
    logger.warn('getCitaDetalle: invitados', invErr.message)
    return null
  }

  // Nombres de los invitados internos (display) vía service role.
  const usuarioIds = (invitados ?? [])
    .map((i) => i.usuario_id)
    .filter((id): id is string => id !== null)
  const nombres = new Map<string, string>()
  if (usuarioIds.length > 0) {
    const service = createServiceRoleClient()
    const { data: usuarios } = await service
      .from('usuarios')
      .select('id, nombre_completo')
      .in('id', usuarioIds)
    for (const u of usuarios ?? []) nombres.set(u.id, u.nombre_completo)
  }

  const roster: InvitadoRoster[] = (invitados ?? []).map((i) => ({
    id: i.id,
    usuario_id: i.usuario_id,
    nombre: i.usuario_id ? (nombres.get(i.usuario_id) ?? '') : (i.nombre_externo ?? ''),
    es_externo: i.usuario_id === null,
    estado: i.estado,
    respondido_at: i.respondido_at,
    comentario: i.comentario,
  }))

  const recuento = { pendiente: 0, aceptado: 0, rechazado: 0 }
  for (const r of roster) recuento[r.estado] += 1

  const miFila = roster.find((r) => r.usuario_id === userId)
  const miEstado: RsvpEstado | null = miFila?.estado ?? null

  return {
    cita: {
      id: cita.id,
      tipo: cita.tipo,
      titulo: cita.titulo,
      descripcion: cita.descripcion,
      lugar: cita.lugar,
      fecha: cita.fecha,
      hora_inicio: cita.hora_inicio,
      hora_fin: cita.hora_fin,
      estado: cita.estado,
      aula_id: cita.aula_id,
      nino_id: cita.nino_id,
      es_organizador: cita.organizador_id === userId,
      mi_estado: miEstado,
    },
    roster,
    recuento,
  }
}
