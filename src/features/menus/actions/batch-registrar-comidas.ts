'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { asegurarAgenda } from '@/features/agenda-diaria/actions/upsert-agenda-cabecera'
import { logger } from '@/shared/lib/logger'

import { comidaBatchInputSchema, type ComidaBatchInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Registro batch del pase de lista de comida.
 *
 * `comidas` (Fase 3) NO tiene UNIQUE (agenda_id, momento) — puede haber
 * varias filas para el mismo momento (ej. dos meriendas). El batch sigue
 * el contrato "una fila por niño y momento desde el pase de lista":
 *   1. Asegura la cabecera `agendas_diarias` del (nino_id, fecha) — lazy.
 *   2. Busca la primera fila existente para (agenda_id, momento).
 *      Si existe → UPDATE (corrige cantidad/descripción/observaciones).
 *      Si no existe → INSERT.
 *
 * RLS de `comidas` (F3) impone `dentro_de_ventana_edicion(fecha)` —
 * no hace falta validarlo aquí. Si la profe trata de batch sobre día
 * cerrado, los INSERT/UPDATE fallan con 42501.
 *
 * El servidor copia la `descripcion` que llega del cliente (puede ser
 * el menú del día o un override por niño). La `hora` se deja NULL
 * porque el batch no maneja hora exacta.
 */
export async function batchRegistrarComidas(
  input: ComidaBatchInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = comidaBatchInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'comida_batch.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { fecha, momento, items } = parsed.data

  let written = 0
  for (const item of items) {
    const agendaId = await asegurarAgenda(item.nino_id, fecha)
    if (!agendaId) {
      logger.warn('batchRegistrarComidas — asegurarAgenda devolvió null')
      return fail('comida_batch.errors.fuera_de_ventana')
    }

    const { data: existing } = await supabase
      .from('comidas')
      .select('id')
      .eq('agenda_id', agendaId)
      .eq('momento', momento)
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase
        .from('comidas')
        .update({
          cantidad: item.cantidad,
          descripcion: item.descripcion,
          observaciones: item.observaciones,
        })
        .eq('id', existing.id)
      if (error) {
        logger.warn('batchRegistrarComidas — UPDATE falló', error.message)
        if (error.code === '42501' || error.message.includes('row-level security')) {
          return fail('comida_batch.errors.fuera_de_ventana')
        }
        return fail('comida_batch.errors.guardar_fallo')
      }
    } else {
      const { error } = await supabase.from('comidas').insert({
        agenda_id: agendaId,
        momento,
        hora: null,
        cantidad: item.cantidad,
        descripcion: item.descripcion,
        observaciones: item.observaciones,
      })
      if (error) {
        logger.warn('batchRegistrarComidas — INSERT falló', error.message)
        if (error.code === '42501' || error.message.includes('row-level security')) {
          return fail('comida_batch.errors.fuera_de_ventana')
        }
        return fail('comida_batch.errors.guardar_fallo')
      }
    }
    written++
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ count: written })
}
