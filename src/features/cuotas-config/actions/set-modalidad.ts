'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

// 'ninguna' = no se cobra ese concepto a ese niño en ese mes (soft-delete de la fila).
const inputSchema = z.object({
  centroId: z.string().uuid(),
  ninoId: z.string().uuid(),
  conceptoId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  modalidad: z.enum(['mensual', 'diario', 'ninguna']),
})

export async function setModalidad(
  centroId: string,
  ninoId: string,
  conceptoId: string,
  anio: number,
  mes: number,
  modalidad: 'mensual' | 'diario' | 'ninguna'
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ centroId, ninoId, conceptoId, anio, mes, modalidad })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()

  const { data: existente, error: selErr } = await supabase
    .from('asignacion_cuota')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('concepto_id', conceptoId)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('setModalidad select', selErr.message)
    return fail('cuotas_config.errors.modalidad_failed')
  }

  if (modalidad === 'ninguna') {
    if (existente) {
      const { error } = await supabase
        .from('asignacion_cuota')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', existente.id)
      if (error) {
        logger.warn('setModalidad delete', error.message)
        if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
        return fail('cuotas_config.errors.modalidad_failed')
      }
    }
    revalidatePath(RUTA, 'page')
    return ok(undefined)
  }

  const { error } = existente
    ? await supabase.from('asignacion_cuota').update({ modalidad }).eq('id', existente.id)
    : await supabase.from('asignacion_cuota').insert({
        centro_id: centroId,
        nino_id: ninoId,
        concepto_id: conceptoId,
        anio,
        mes,
        modalidad,
      })

  if (error) {
    logger.warn('setModalidad upsert', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.modalidad_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
