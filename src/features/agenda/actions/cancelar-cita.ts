'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { revalidarAgenda } from '../lib/server-helpers'
import { cancelarCitaSchema, type CancelarCitaInput } from '../schemas/citas'
import { fail, ok, type ActionResult } from '../types'

/**
 * Cancela una cita: `estado='cancelada'` (no DELETE; patrón del proyecto). La
 * autorización (organizador o admin) la enforza la RLS `citas_update`. Las filas
 * `cita_invitados` se conservan. Notificación push diferida (AG-10).
 */
export async function cancelarCita(
  input: CancelarCitaInput
): Promise<ActionResult<{ cita_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('citas.errors.no_autorizado')

  const result = await cancelarCitaCore(supabase, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function cancelarCitaCore(
  supabase: SupabaseClient<Database>,
  input: CancelarCitaInput
): Promise<ActionResult<{ cita_id: string }>> {
  const parsed = cancelarCitaSchema.safeParse(input)
  if (!parsed.success) return fail('citas.errors.cancelacion_fallo')

  // Solo cancela una cita programada (idempotente: re-cancelar → 0 filas).
  const { data: cancelada, error } = await supabase
    .from('citas')
    .update({ estado: 'cancelada' })
    .eq('id', parsed.data.cita_id)
    .eq('estado', 'programada')
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('cancelarCita: update', error.message)
    if (error.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.cancelacion_fallo')
  }
  if (!cancelada) return fail('citas.errors.no_autorizado')

  return ok({ cita_id: cancelada.id })
}
