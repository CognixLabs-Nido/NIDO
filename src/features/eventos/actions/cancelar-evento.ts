'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { notificarCancelacion } from '../lib/notificar'
import { revalidarCalendario } from '../lib/server-helpers'
import { cancelarEventoSchema } from '../schemas/eventos'
import { fail, ok, type ActionResult } from '../types'

/**
 * Cancela un evento → `estado='cancelado'` (no se borra; D7). RLS autoriza al
 * autor o admin (D8). Tras cancelar, **notifica por push a quien ya había
 * confirmado** (D7: no es un flip silencioso). Best-effort.
 */
export async function cancelarEvento(input: { evento_id: string }): Promise<ActionResult<void>> {
  const parsed = cancelarEventoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'eventos.errors.cancelacion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('eventos.errors.no_autorizado')

  const { data: updated, error } = await supabase
    .from('eventos')
    .update({ estado: 'cancelado' })
    .eq('id', parsed.data.evento_id)
    .select('id, titulo')
    .maybeSingle()

  if (error) {
    logger.warn('cancelarEvento: update', error.message)
    if (error.code === '42501') return fail('eventos.errors.no_autorizado')
    return fail('eventos.errors.cancelacion_fallo')
  }
  if (!updated) return fail('eventos.errors.no_autorizado')

  await notificarCancelacion(userId, updated.id, updated.titulo)

  revalidarCalendario()
  return ok(undefined)
}
