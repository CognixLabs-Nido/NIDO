'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { comidaInputSchema, type ComidaInput } from '../schemas/agenda-diaria'
import { fail, ok, type ActionResult } from '../types'

import { asegurarAgenda } from './upsert-agenda-cabecera'

/**
 * Crea o actualiza una comida. Si `input.id` viene presente → UPDATE. Si no
 * → INSERT (asegura primero la cabecera de (nino_id, fecha)). RLS impone
 * la ventana de edición y los roles permitidos.
 */
export async function upsertComida(
  ninoId: string,
  fecha: string,
  input: ComidaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = comidaInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'agenda.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const payload = {
    momento: parsed.data.momento,
    hora: parsed.data.hora,
    cantidad: parsed.data.cantidad,
    descripcion: parsed.data.descripcion,
    observaciones: parsed.data.observaciones,
  }

  if (parsed.data.id) {
    const { data, error } = await supabase
      .from('comidas')
      .update(payload)
      .eq('id', parsed.data.id)
      .select('id')
      .single()
    if (error || !data) {
      logger.warn('upsertComida update failed', error?.message)
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
    .from('comidas')
    .insert({ agenda_id: agendaId, ...payload })
    .select('id')
    .single()
  if (error || !data) {
    logger.warn('upsertComida insert failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('agenda.errors.fuera_de_ventana')
    }
    return fail('agenda.errors.guardar_fallo')
  }
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}
