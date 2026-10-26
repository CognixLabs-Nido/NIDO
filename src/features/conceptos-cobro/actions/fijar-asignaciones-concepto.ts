'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

const inputSchema = z.object({
  conceptoId: z.string().uuid(),
  cambios: z
    .array(z.object({ id: z.string().uuid(), asignada: z.boolean() }))
    .min(1)
    .max(3000),
})

/**
 * El concepto se gestiona desde el concepto: guarda de una vez a qué niños (o familias, según su
 * ámbito) se asigna, por `fijar_asignaciones_concepto`, en una transacción: o entran todos los
 * cambios, o ninguno. Dirección del centro del concepto: la función lo comprueba (42501).
 */
export async function fijarAsignacionesConcepto(
  conceptoId: string,
  cambios: Array<{ id: string; asignada: boolean }>
): Promise<ActionResult<{ asignadas: number; quitadas: number }>> {
  const parsed = inputSchema.safeParse({ conceptoId, cambios })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_asignaciones_concepto', {
    p_concepto_id: parsed.data.conceptoId,
    p_cambios: parsed.data.cambios,
  })

  if (error || !data) {
    logger.warn('fijarAsignacionesConcepto error', error?.message)
    if (error?.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    // El concepto se borró, se desactivó o pasó a automático con el diálogo abierto.
    if (error?.hint === 'concepto_no_asignable')
      return fail('cuotas_config.errors.concepto_no_asignable')
    return fail('cuotas_config.errors.asignacion_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({
    asignadas: data.filter((r) => r.resultado === 'asignada').length,
    quitadas: data.filter((r) => r.resultado === 'quitada').length,
  })
}
