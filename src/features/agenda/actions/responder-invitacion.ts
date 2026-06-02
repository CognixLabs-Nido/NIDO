'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { citaYaComenzo, revalidarAgenda } from '../lib/server-helpers'
import { responderInvitacionSchema, type ResponderInvitacionInput } from '../schemas/citas'
import { fail, ok, type ActionResult } from '../types'

/**
 * RSVP de un invitado interno sobre **su propia** fila (`usuario_id = auth.uid()`).
 * Idempotente, last-write-wins. Ventana abierta hasta la hora de inicio (AG-11);
 * la cierra el action (la RLS de `cita_invitados` no lleva ventana temporal).
 */
export async function responderInvitacion(
  input: ResponderInvitacionInput
): Promise<ActionResult<{ cita_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('citas.errors.no_autorizado')

  const result = await responderInvitacionCore(supabase, userId, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function responderInvitacionCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: ResponderInvitacionInput
): Promise<ActionResult<{ cita_id: string }>> {
  const parsed = responderInvitacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'citas.errors.rsvp_fallo')
  }
  const d = parsed.data

  const { data: cita, error: readErr } = await supabase
    .from('citas')
    .select('fecha, hora_inicio, estado')
    .eq('id', d.cita_id)
    .maybeSingle()
  if (readErr) {
    logger.warn('responderInvitacion: read cita', readErr.message)
    return fail('citas.errors.rsvp_fallo')
  }
  if (!cita) return fail('citas.errors.no_encontrada')
  if (cita.estado === 'cancelada') return fail('citas.errors.cita_cancelada')
  if (citaYaComenzo(cita.fecha, cita.hora_inicio)) return fail('citas.errors.ventana_cerrada')

  const { data: actualizada, error: updErr } = await supabase
    .from('cita_invitados')
    .update({
      estado: d.estado,
      comentario: d.comentario ?? null,
      respondido_at: new Date().toISOString(),
      respondido_por: userId,
    })
    .eq('cita_id', d.cita_id)
    .eq('usuario_id', userId)
    .select('id')
    .maybeSingle()

  if (updErr) {
    logger.warn('responderInvitacion: update', updErr.message)
    return fail('citas.errors.rsvp_fallo')
  }
  // 0 filas: no es invitado de esta cita (o RLS lo rechazó).
  if (!actualizada) return fail('citas.errors.no_invitado')

  return ok({ cita_id: d.cita_id })
}
