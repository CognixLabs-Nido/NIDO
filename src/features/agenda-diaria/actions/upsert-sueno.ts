'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { suenoInputSchema, type SuenoInput } from '../schemas/agenda-diaria'
import { fail, ok, type ActionResult } from '../types'

import { asegurarAgenda } from './upsert-agenda-cabecera'

export async function upsertSueno(
  ninoId: string,
  fecha: string,
  input: SuenoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = suenoInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'agenda.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const payload = {
    hora_inicio: parsed.data.hora_inicio,
    hora_fin: parsed.data.hora_fin,
    calidad: parsed.data.calidad,
    observaciones: parsed.data.observaciones,
  }

  if (parsed.data.id) {
    const { data, error } = await supabase
      .from('suenos')
      .update(payload)
      .eq('id', parsed.data.id)
      .select('id')
      .single()
    if (error || !data) {
      logger.warn('upsertSueno update failed', error?.message)
      if (error?.code === '42501' || error?.message.includes('row-level security')) {
        return fail('agenda.errors.fuera_de_ventana')
      }
      return fail('agenda.errors.guardar_fallo')
    }
    revalidatePath('/[locale]/teacher/aula/[id]', 'page')
    revalidatePath('/[locale]/family/nino/[id]', 'page')
    return ok({ id: data.id })
  }

  const agendaId = await asegurarAgenda(ninoId, fecha)
  if (!agendaId) return fail('agenda.errors.fuera_de_ventana')

  const { data, error } = await supabase
    .from('suenos')
    .insert({ agenda_id: agendaId, ...payload })
    .select('id')
    .single()
  if (error || !data) {
    logger.warn('upsertSueno insert failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('agenda.errors.fuera_de_ventana')
    }
    return fail('agenda.errors.guardar_fallo')
  }
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}
