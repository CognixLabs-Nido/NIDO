'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { PREFIX_ANULADO, tablaEventoEnum, type TablaEvento } from '../schemas/agenda-diaria'
import { fail, ok, type ActionResult } from '../types'

/**
 * Marca un evento como erróneo (sustituto del DELETE — la RLS bloquea
 * DELETE para todos los roles). El UPDATE antepone `[anulado] ` al campo
 * `observaciones`. Idempotente: si ya empieza por el prefijo, no se
 * duplica.
 */
export async function marcarEventoErroneo(
  tabla: TablaEvento,
  id: string
): Promise<ActionResult<{ id: string }>> {
  const parsedTabla = tablaEventoEnum.safeParse(tabla)
  if (!parsedTabla.success) return fail('agenda.errors.guardar_fallo')

  const supabase = await createClient()
  // 1. Leemos el valor actual de observaciones para conservar el contenido
  //    y aplicar el prefijo de forma idempotente.
  const { data: row, error: readErr } = await supabase
    .from(parsedTabla.data)
    .select('observaciones')
    .eq('id', id)
    .single()
  if (readErr || !row) {
    logger.warn('marcarEventoErroneo lectura fallida', readErr?.message)
    return fail('agenda.errors.guardar_fallo')
  }

  const prev = (row as { observaciones: string | null }).observaciones ?? ''
  if (prev.startsWith(PREFIX_ANULADO)) {
    // Ya está marcado: idempotente, no hace falta UPDATE.
    return ok({ id })
  }

  const nuevasObs = `${PREFIX_ANULADO}${prev}`.slice(0, 500)
  const { error: updateErr } = await supabase
    .from(parsedTabla.data)
    .update({ observaciones: nuevasObs })
    .eq('id', id)

  if (updateErr) {
    logger.warn('marcarEventoErroneo update fallido', updateErr.message)
    if (updateErr.code === '42501' || updateErr.message.includes('row-level security')) {
      return fail('agenda.errors.fuera_de_ventana')
    }
    return fail('agenda.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id })
}
