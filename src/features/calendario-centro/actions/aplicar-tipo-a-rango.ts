'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { aplicarTipoARangoSchema, type AplicarTipoARangoInput } from '../schemas/dia-centro'
import { fail, ok, type ActionResult } from '../types'

/**
 * Aplica un tipo a un rango de días [desde, hasta] (ambos inclusive)
 * para el centro. Itera fechas en JS y hace un UPSERT por día con
 * `onConflict (centro_id, fecha)`. Cada operación dispara el audit
 * trigger por fila, así que las N filas quedan registradas.
 *
 * Decisiones:
 *  - Span máximo 366 días (anti-abuso, validado por Zod).
 *  - `creado_por` se setea a `auth.uid()` en INSERT y se preserva en
 *    UPDATE (mismo motivo que `upsertDiaCentro`).
 *  - Idempotente: si el rango incluye días ya marcados con el mismo
 *    tipo, no pasa nada — se "actualiza" a sí mismo.
 */
export async function aplicarTipoARango(
  input: AplicarTipoARangoInput
): Promise<ActionResult<{ dias: number }>> {
  const parsed = aplicarTipoARangoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'calendario.toasts.error_guardar')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const desde = new Date(`${parsed.data.desde}T00:00:00Z`)
  const hasta = new Date(`${parsed.data.hasta}T00:00:00Z`)
  const fechas: string[] = []
  const cursor = new Date(desde)
  while (cursor.getTime() <= hasta.getTime()) {
    const y = cursor.getUTCFullYear()
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0')
    const d = String(cursor.getUTCDate()).padStart(2, '0')
    fechas.push(`${y}-${m}-${d}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // Recuperar IDs existentes en una sola query.
  const { data: existentes, error: lookupErr } = await supabase
    .from('dias_centro')
    .select('id, fecha')
    .eq('centro_id', parsed.data.centro_id)
    .in('fecha', fechas)

  if (lookupErr) {
    logger.warn('aplicarTipoARango lookup failed', lookupErr.message)
    return fail('calendario.toasts.error_guardar')
  }

  const fechasExistentes = new Set((existentes ?? []).map((d) => d.fecha))
  const aInsertar = fechas.filter((f) => !fechasExistentes.has(f))
  const aActualizar = fechas.filter((f) => fechasExistentes.has(f))

  // UPDATE en bloque para las que ya existen.
  if (aActualizar.length > 0) {
    const { error: updErr } = await supabase
      .from('dias_centro')
      .update({ tipo: parsed.data.tipo, observaciones: parsed.data.observaciones })
      .eq('centro_id', parsed.data.centro_id)
      .in('fecha', aActualizar)
    if (updErr) {
      logger.warn('aplicarTipoARango update failed', updErr.message)
      return fail('calendario.toasts.error_guardar')
    }
  }

  // INSERT en bloque para las nuevas.
  if (aInsertar.length > 0) {
    const filas = aInsertar.map((f) => ({
      centro_id: parsed.data.centro_id,
      fecha: f,
      tipo: parsed.data.tipo,
      observaciones: parsed.data.observaciones,
      creado_por: userId,
    }))
    const { error: insErr } = await supabase.from('dias_centro').insert(filas)
    if (insErr) {
      logger.warn('aplicarTipoARango insert failed', insErr.message)
      return fail('calendario.toasts.error_guardar')
    }
  }

  revalidatePath('/[locale]/admin/calendario', 'page')
  revalidatePath('/[locale]/teacher/calendario', 'page')
  revalidatePath('/[locale]/family/calendario', 'page')
  revalidatePath('/[locale]/family', 'page')
  revalidatePath('/[locale]/teacher', 'page')

  return ok({ dias: fechas.length })
}
