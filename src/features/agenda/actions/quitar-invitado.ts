'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { revalidarAgenda } from '../lib/server-helpers'
import { quitarInvitadoSchema, type QuitarInvitadoInput } from '../schemas/citas'
import { fail, ok, type ActionResult } from '../types'

/**
 * Quita un invitado de una cita (AG-02). DELETE de la fila — excepción explícita
 * al patrón "DELETE bloqueado" (como `dias_centro`). La autorización
 * (organizador/admin) la enforza la RLS `cita_invitados_delete`; la traza queda
 * en `audit_log`. Un invitado no puede auto-eliminarse (responde `rechazado`).
 */
export async function quitarInvitado(
  input: QuitarInvitadoInput
): Promise<ActionResult<{ invitado_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('citas.errors.no_autorizado')

  const result = await quitarInvitadoCore(supabase, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function quitarInvitadoCore(
  supabase: SupabaseClient<Database>,
  input: QuitarInvitadoInput
): Promise<ActionResult<{ invitado_id: string }>> {
  const parsed = quitarInvitadoSchema.safeParse(input)
  if (!parsed.success) return fail('citas.errors.invitados_fallo')

  const { data: borrado, error } = await supabase
    .from('cita_invitados')
    .delete()
    .eq('id', parsed.data.invitado_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('quitarInvitado: delete', error.message)
    if (error.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.invitados_fallo')
  }
  // 0 filas: no autorizado (RLS) o no existe.
  if (!borrado) return fail('citas.errors.no_autorizado')

  return ok({ invitado_id: borrado.id })
}
