'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/cuotas'

const inputSchema = z.object({
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
})

/**
 * F-4-4: GENERA los borradores familiares del mes vía `generar_recibos_mes`. Re-ejecutable
 * y DESTRUCTIVA sobre borradores (wipe+rebuild; respeta los confirmados). El diálogo de la
 * UI avisa antes de regenerar. Devuelve cuántos recibos quedaron generados. Solo admin.
 */
export async function generarRecibosMes(input: {
  anio: number
  mes: number
}): Promise<ActionResult<{ generados: number }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('recibos_panel.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generar_recibos_mes', {
    p_centro_id: centroId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
  })

  if (error || data === null) {
    logger.warn('generarRecibosMes error', error?.message)
    if (error?.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error?.code === 'P0001') return fail('recibos_panel.errors.mes_cerrado')
    return fail('recibos_panel.errors.generar_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ generados: data })
}
