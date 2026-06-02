'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { revalidarAgenda } from '../lib/server-helpers'
import { marcarAsistenciaExternoSchema, type MarcarAsistenciaExternoInput } from '../schemas/citas'
import { fail, ok, type ActionResult } from '../types'

/**
 * El organizador/admin marca el RSVP de un invitado **externo** (sin cuenta, sin
 * RSVP digital). Solo aplica a filas con `usuario_id IS NULL`. La autorización la
 * enforza la RLS `cita_invitados_update` (organizador/admin).
 */
export async function marcarAsistenciaExterno(
  input: MarcarAsistenciaExternoInput
): Promise<ActionResult<{ invitado_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('citas.errors.no_autorizado')

  const result = await marcarAsistenciaExternoCore(supabase, userId, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function marcarAsistenciaExternoCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: MarcarAsistenciaExternoInput
): Promise<ActionResult<{ invitado_id: string }>> {
  const parsed = marcarAsistenciaExternoSchema.safeParse(input)
  if (!parsed.success) return fail('citas.errors.rsvp_fallo')
  const d = parsed.data

  const { data: actualizada, error } = await supabase
    .from('cita_invitados')
    .update({
      estado: d.estado,
      respondido_at: new Date().toISOString(),
      respondido_por: userId,
    })
    .eq('id', d.invitado_id)
    .is('usuario_id', null) // solo externos
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('marcarAsistenciaExterno: update', error.message)
    if (error.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.rsvp_fallo')
  }
  if (!actualizada) return fail('citas.errors.no_autorizado')

  return ok({ invitado_id: actualizada.id })
}
