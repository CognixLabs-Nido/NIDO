'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { asistenciaInputSchema, type AsistenciaInput } from '../schemas/asistencia'
import { fail, ok, type ActionResult } from '../types'

/**
 * Upsert idempotente de asistencia para (nino_id, fecha). RLS impone:
 *  - ventana de edición (mismo día Madrid)
 *  - rol admin o profe del aula del niño
 *
 * Lazy (ADR-0015): no creamos filas por adelantado, esto es la primera y
 * única vía de entrada.
 */
export async function upsertAsistencia(
  ninoId: string,
  fecha: string,
  input: AsistenciaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = asistenciaInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'asistencia.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const payload = {
    nino_id: ninoId,
    fecha,
    estado: parsed.data.estado,
    hora_llegada: parsed.data.hora_llegada,
    hora_salida: parsed.data.hora_salida,
    observaciones: parsed.data.observaciones,
    registrada_por: userId,
  }

  const { data, error } = await supabase
    .from('asistencias')
    .upsert(payload, { onConflict: 'nino_id,fecha' })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('upsertAsistencia failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('asistencia.errors.fuera_de_ventana')
    }
    return fail('asistencia.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/admin', 'page')
  return ok({ id: data.id })
}
