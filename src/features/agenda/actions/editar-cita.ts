'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { revalidarAgenda } from '../lib/server-helpers'
import { editarCitaSchema, type EditarCitaInput } from '../schemas/citas'
import { fail, ok, type ActionResult } from '../types'

/**
 * Edita el contenido y las fechas de una cita (no su tipo ni sus invitados). La
 * autorización (organizador o admin) la enforza la RLS `citas_update`; aquí solo
 * rechazamos editar una cita ya cancelada. Notificación push diferida (AG-10).
 */
export async function editarCita(
  input: EditarCitaInput
): Promise<ActionResult<{ cita_id: string }>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('citas.errors.no_autorizado')

  const result = await editarCitaCore(supabase, input)
  if (result.success) revalidarAgenda()
  return result
}

export async function editarCitaCore(
  supabase: SupabaseClient<Database>,
  input: EditarCitaInput
): Promise<ActionResult<{ cita_id: string }>> {
  const parsed = editarCitaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'citas.errors.edicion_fallo')
  }
  const d = parsed.data

  const { data: cita, error: readErr } = await supabase
    .from('citas')
    .select('estado')
    .eq('id', d.cita_id)
    .maybeSingle()
  if (readErr) {
    logger.warn('editarCita: read', readErr.message)
    return fail('citas.errors.edicion_fallo')
  }
  if (!cita) return fail('citas.errors.no_encontrada')
  if (cita.estado === 'cancelada') return fail('citas.errors.cita_cancelada')

  const { data: actualizada, error: updErr } = await supabase
    .from('citas')
    .update({
      titulo: d.titulo,
      descripcion: d.descripcion ?? null,
      lugar: d.lugar ?? null,
      fecha: d.fecha,
      hora_inicio: d.hora_inicio,
      hora_fin: d.hora_fin ?? null,
    })
    .eq('id', d.cita_id)
    .select('id')
    .maybeSingle()

  if (updErr) {
    logger.warn('editarCita: update', updErr.message)
    if (updErr.code === '42501') return fail('citas.errors.no_autorizado')
    return fail('citas.errors.edicion_fallo')
  }
  // USING falso → 0 filas (no autorizado): el cliente recibe data null sin error.
  if (!actualizada) return fail('citas.errors.no_autorizado')

  return ok({ cita_id: actualizada.id })
}
