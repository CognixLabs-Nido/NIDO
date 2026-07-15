'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

// F-4-4: asignación PERMANENTE de un concepto de ámbito FAMILIA (descuento hermanos,
// cargo familiar) a una familia (origen='manual'). Sin mes. Idempotente por el UNIQUE
// parcial. Espejo por-familia de asignar-concepto (que es por-niño).
const inputSchema = z.object({
  centroId: z.string().uuid(),
  familiaId: z.string().uuid(),
  conceptoId: z.string().uuid(),
})

export async function asignarConceptoFamilia(
  centroId: string,
  familiaId: string,
  conceptoId: string
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ centroId, familiaId, conceptoId })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()

  const { data: existente, error: selErr } = await supabase
    .from('asignacion_concepto')
    .select('id')
    .eq('concepto_id', conceptoId)
    .eq('familia_id', familiaId)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('asignarConceptoFamilia select', selErr.message)
    return fail('cuotas_config.errors.asignacion_failed')
  }

  if (existente) {
    revalidatePath(RUTA, 'page')
    return ok(undefined)
  }

  const { error } = await supabase.from('asignacion_concepto').insert({
    centro_id: centroId,
    familia_id: familiaId,
    concepto_id: conceptoId,
    origen: 'manual',
  })

  if (error) {
    logger.warn('asignarConceptoFamilia insert', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.asignacion_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
