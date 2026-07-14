'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

// F-4-2: asigna PERMANENTEMENTE un concepto a un niño (origen='manual'). Sin mes,
// sin modalidad (la periodicidad sale de conceptos_cobro.tipo_concepto). Idempotente:
// si ya hay una fila viva para (concepto, niño) no hace nada (respeta el UNIQUE parcial).
// La asignación por FAMILIA (descuento hermanos) y el override mensual son de F-4-4/F-4-3.
const inputSchema = z.object({
  centroId: z.string().uuid(),
  ninoId: z.string().uuid(),
  conceptoId: z.string().uuid(),
})

export async function asignarConcepto(
  centroId: string,
  ninoId: string,
  conceptoId: string
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ centroId, ninoId, conceptoId })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()

  const { data: existente, error: selErr } = await supabase
    .from('asignacion_concepto')
    .select('id')
    .eq('concepto_id', conceptoId)
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('asignarConcepto select', selErr.message)
    return fail('cuotas_config.errors.asignacion_failed')
  }

  // Ya asignado → no-op idempotente.
  if (existente) {
    revalidatePath(RUTA, 'page')
    return ok(undefined)
  }

  const { error } = await supabase.from('asignacion_concepto').insert({
    centro_id: centroId,
    nino_id: ninoId,
    concepto_id: conceptoId,
    origen: 'manual',
  })

  if (error) {
    logger.warn('asignarConcepto insert', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.asignacion_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
