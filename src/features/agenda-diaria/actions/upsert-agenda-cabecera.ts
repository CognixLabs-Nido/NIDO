'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { agendaCabeceraInputSchema, type AgendaCabeceraInput } from '../schemas/agenda-diaria'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea o actualiza la fila padre `agendas_diarias` para (nino_id, fecha).
 * Es idempotente: el `onConflict` por la UNIQUE(nino_id, fecha) hace UPDATE
 * si ya existe. Las RLS de INSERT/UPDATE exigen ventana de edición.
 */
export async function upsertAgendaCabecera(
  input: AgendaCabeceraInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = agendaCabeceraInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'agenda.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agendas_diarias')
    .upsert(
      {
        nino_id: parsed.data.nino_id,
        fecha: parsed.data.fecha,
        estado_general: parsed.data.estado_general,
        humor: parsed.data.humor,
        observaciones_generales: parsed.data.observaciones_generales,
      },
      { onConflict: 'nino_id,fecha' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('upsertAgendaCabecera failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('agenda.errors.fuera_de_ventana')
    }
    return fail('agenda.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}

/**
 * Helper interno: asegura que existe una fila padre para (nino_id, fecha).
 * Devuelve `agenda_id`. Si la inserción falla por RLS (fuera de ventana o
 * sin permisos), devuelve null y deja al caller fallar con un error
 * tipado.
 */
export async function asegurarAgenda(ninoId: string, fecha: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('agendas_diarias')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('fecha', fecha)
    .maybeSingle()
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('agendas_diarias')
    .insert({ nino_id: ninoId, fecha })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('asegurarAgenda insert failed', error?.message)
    return null
  }
  return data.id
}
