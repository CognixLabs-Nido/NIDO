'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { asistenciaBatchInputSchema, type AsistenciaBatchInput } from '../schemas/asistencia'
import { fail, ok, type ActionResult } from '../types'

/**
 * Upsert por lotes: el pase de lista envía solo filas dirty. Una sola
 * llamada a `upsert(...)` con todos los rows + `onConflict='nino_id,fecha'`.
 *
 * Si una sola fila falla (RLS por ejemplo), Postgres rechaza toda la
 * transacción. Devolvemos el error genérico; el cliente decide cómo
 * pintar los rows como `error`.
 */
export async function batchUpsertAsistencias(
  input: AsistenciaBatchInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = asistenciaBatchInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'asistencia.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const rows = parsed.data.items.map((it) => ({
    nino_id: it.nino_id,
    fecha: parsed.data.fecha,
    estado: it.asistencia.estado,
    hora_llegada: it.asistencia.hora_llegada,
    hora_salida: it.asistencia.hora_salida,
    observaciones: it.asistencia.observaciones,
    registrada_por: userId,
  }))

  const { error, count } = await supabase
    .from('asistencias')
    .upsert(rows, { onConflict: 'nino_id,fecha', count: 'exact' })

  if (error) {
    logger.warn('batchUpsertAsistencias failed', error.message)
    if (error.code === '42501' || error.message.includes('row-level security')) {
      return fail('asistencia.errors.fuera_de_ventana')
    }
    return fail('asistencia.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/admin', 'page')
  return ok({ count: count ?? rows.length })
}
