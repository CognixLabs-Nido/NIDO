'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

// F-4-2: retira la asignación permanente de un concepto a un niño (soft-delete). Si
// la fila era origen='automatico', esta baja se respeta: proponer_asignaciones() NO la
// vuelve a sembrar (comprueba existencia incl. soft-borradas).
const inputSchema = z.object({
  centroId: z.string().uuid(),
  ninoId: z.string().uuid(),
  conceptoId: z.string().uuid(),
})

export async function desasignarConcepto(
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
    logger.warn('desasignarConcepto select', selErr.message)
    return fail('cuotas_config.errors.asignacion_failed')
  }

  // Ya no asignado → no-op idempotente.
  if (!existente) {
    revalidatePath(RUTA, 'page')
    return ok(undefined)
  }

  const { error } = await supabase
    .from('asignacion_concepto')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', existente.id)

  if (error) {
    logger.warn('desasignarConcepto update', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.asignacion_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
