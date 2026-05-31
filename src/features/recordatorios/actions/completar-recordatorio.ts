'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { completarRecordatorioSchema } from '../schemas/recordatorios'
import { fail, ok, type ActionResult } from '../types'

/**
 * Marca un recordatorio como completado (F6, 🔒 D6).
 *
 * Idempotencia + race safety (ADR-0036): el UPDATE lleva
 * `.is('completado_en', null)`, de modo que solo afecta a filas que SEGUÍAN
 * pendientes. Pedimos `.select('id').maybeSingle()`:
 *   - fila devuelta  → lo completamos nosotros.
 *   - `data === null`, `error === null` → o bien ya estaba completado (otro
 *     destinatario ganó la carrera), o bien la RLS USING rechazó. En ambos
 *     casos devolvemos `ya_completado`: la UI optimista revierte sin error duro.
 *
 * Pueden completar destinatario o emisor (cualquiera que vea el recordatorio
 * según RLS). Sin límite temporal.
 */
export async function completarRecordatorio(input: {
  recordatorio_id: string
}): Promise<ActionResult<{ recordatorio_id: string }>> {
  const parsed = completarRecordatorioSchema.safeParse(input)
  if (!parsed.success) {
    return fail('recordatorios.errors.creacion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('recordatorios.errors.no_autorizado')

  const result = await completarRecordatorioCore(supabase, userId, parsed.data.recordatorio_id)
  if (result.success) {
    revalidatePath('/[locale]/reminders', 'layout')
  }
  return result
}

export async function completarRecordatorioCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  recordatorioId: string
): Promise<ActionResult<{ recordatorio_id: string }>> {
  const { data: updated, error } = await supabase
    .from('recordatorios')
    .update({ completado_en: new Date().toISOString(), completado_por: userId })
    .eq('id', recordatorioId)
    .is('completado_en', null) // solo si seguía pendiente → idempotente / race-safe
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '42501') return fail('recordatorios.errors.no_autorizado')
    logger.warn('completarRecordatorio: update', error.message)
    return fail('recordatorios.errors.creacion_fallo')
  }
  if (!updated) {
    // Ya estaba completado (otro ganó la carrera) o RLS USING rechazó.
    return fail('recordatorios.errors.ya_completado')
  }

  return ok({ recordatorio_id: recordatorioId })
}
