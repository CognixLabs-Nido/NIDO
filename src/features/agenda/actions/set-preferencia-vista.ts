'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  setPreferenciaVistaAgendaSchema,
  type SetPreferenciaVistaAgendaInput,
} from '../schemas/citas'
import { fail, ok, type ActionResult, PREF_VISTA_AGENDA } from '../types'

/**
 * Persiste la preferencia de vista de la Agenda del usuario (AG-07) en la tabla
 * clave-valor `preferencias_usuario`. Upsert por (usuario_id, clave). RLS de
 * aislamiento estricto por `usuario_id = auth.uid()`.
 */
export async function setPreferenciaVistaAgenda(
  input: SetPreferenciaVistaAgendaInput
): Promise<ActionResult<void>> {
  const parsed = setPreferenciaVistaAgendaSchema.safeParse(input)
  if (!parsed.success) return fail('citas.errors.preferencia_fallo')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('citas.errors.no_autorizado')

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: userId, clave: PREF_VISTA_AGENDA, valor: parsed.data.vista },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('setPreferenciaVistaAgenda: upsert', error.message)
    return fail('citas.errors.preferencia_fallo')
  }
  return ok(undefined)
}
