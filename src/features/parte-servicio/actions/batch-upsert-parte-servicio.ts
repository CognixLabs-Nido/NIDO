'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  parteServicioBatchInputSchema,
  type ParteServicioBatchInput,
} from '../schemas/parte-servicio'
import { fail, ok, type ActionResult } from '../types'

/**
 * Upsert por lotes del parte de servicio: el pase de lista envía solo las
 * filas dirty para un (fecha, servicio). Una sola llamada a `upsert(...)`
 * con `onConflict='nino_id,fecha,servicio'`.
 *
 * `centro_id` lo rellena igualmente el trigger `derivar_centro_id_de_nino`,
 * pero lo enviamos explícito para satisfacer el tipo Insert (NOT NULL).
 *
 * RLS impone que solo admin del centro o profe del niño puedan escribir;
 * un 42501 indica que el usuario perdió acceso → mensaje específico para
 * que la UI refresque a solo lectura. Si una fila falla, Postgres revierte
 * toda la transacción.
 */
export async function batchUpsertParteServicio(
  input: ParteServicioBatchInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = parteServicioBatchInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'parte_servicio.errors.guardar_fallo')
  }

  const supabase = await createClient()

  const rows = parsed.data.items.map((it) => ({
    centro_id: parsed.data.centro_id,
    nino_id: it.nino_id,
    fecha: parsed.data.fecha,
    servicio: parsed.data.servicio,
    presente: it.presente,
  }))

  const { error, count } = await supabase
    .from('parte_servicio_diario')
    .upsert(rows, { onConflict: 'nino_id,fecha,servicio', count: 'exact' })

  if (error) {
    logger.warn('batchUpsertParteServicio failed', error.message)
    if (error.code === '42501' || error.message.includes('row-level security')) {
      return fail('parte_servicio.errors.sin_permiso')
    }
    return fail('parte_servicio.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]/servicio', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  return ok({ count: count ?? rows.length })
}
