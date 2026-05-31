'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { PREFIX_ANULADO, VENTANA_ANULACION_MS } from '../lib/constants'
import { anularRecordatorioSchema } from '../schemas/recordatorios'
import { fail, ok, type ActionResult } from '../types'

/**
 * Anula (marca erróneo) un recordatorio creado por error (F6). Mismo patrón
 * que mensajería: flag `erroneo=true` + prefijo `[anulado] ` en `titulo`.
 *
 * Solo el **emisor** y dentro de **5 min** desde `created_at`. A diferencia de
 * mensajería (ventana en RLS), aquí la ventana se enforza en el ACTION porque
 * el UPDATE de `recordatorios` multiplexa completar (sin límite) y anular (5
 * min) — imposible de separar por tiempo en una sola policy (ADR-0036). Tras
 * el pre-check, el UPDATE pide `.select().maybeSingle()`: si vuelve null
 * (la RLS USING rechazó, p.ej. dejó de ver la fila), mapeamos al mismo error.
 */
export async function anularRecordatorio(input: {
  recordatorio_id: string
}): Promise<ActionResult<{ recordatorio_id: string }>> {
  const parsed = anularRecordatorioSchema.safeParse(input)
  if (!parsed.success) {
    return fail('recordatorios.errors.creacion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('recordatorios.errors.no_autorizado')

  const result = await anularRecordatorioCore(supabase, userId, parsed.data.recordatorio_id)
  if (result.success) {
    revalidatePath('/[locale]/reminders', 'layout')
  }
  return result
}

export async function anularRecordatorioCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  recordatorioId: string
): Promise<ActionResult<{ recordatorio_id: string }>> {
  const { data: rec, error: selErr } = await supabase
    .from('recordatorios')
    .select('id, creado_por, titulo, erroneo, created_at')
    .eq('id', recordatorioId)
    .maybeSingle()

  if (selErr || !rec) {
    return fail('recordatorios.errors.no_autorizado')
  }
  if (rec.creado_por !== userId) {
    return fail('recordatorios.errors.no_autorizado')
  }
  if (rec.erroneo) {
    return fail('recordatorios.errors.ya_anulado')
  }

  const ageMs = Date.now() - new Date(rec.created_at).getTime()
  if (ageMs > VENTANA_ANULACION_MS) {
    return fail('recordatorios.errors.ventana_anulacion_expirada')
  }

  const nuevoTitulo = rec.titulo.startsWith(PREFIX_ANULADO)
    ? rec.titulo
    : `${PREFIX_ANULADO}${rec.titulo}`

  const { data: updated, error: updErr } = await supabase
    .from('recordatorios')
    .update({ erroneo: true, titulo: nuevoTitulo })
    .eq('id', recordatorioId)
    .select('id')
    .maybeSingle()

  if (updErr) {
    if (updErr.code === '42501') return fail('recordatorios.errors.no_autorizado')
    logger.warn('anularRecordatorio: update', updErr.message)
    return fail('recordatorios.errors.creacion_fallo')
  }
  if (!updated) {
    // RLS USING rechazó (dejó de ver la fila). Tratamos como no autorizado.
    return fail('recordatorios.errors.no_autorizado')
  }

  return ok({ recordatorio_id: recordatorioId })
}
