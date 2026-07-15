'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

const RUTA = '/[locale]/admin/cuotas'

const inputSchema = z.object({
  centroId: z.string().uuid(),
  ninoId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  metodo: z.enum(['sepa', 'efectivo', 'transferencia']),
})

type MetodoPago = Database['public']['Enums']['metodo_pago']

/**
 * F-4-3: el método de pago es de la FAMILIA (el recibo es familiar), no del niño. La firma
 * sigue recibiendo `ninoId` (la UI de B-2 es por-niño; se rehace en F-4-4): se resuelve la
 * familia del niño y se hace upsert de una única fila `metodo_pago_familia` por familia/mes
 * — así todos los hermanos comparten método automáticamente (ya no hay copia entre hermanos).
 */
export async function setMetodoPago(
  centroId: string,
  ninoId: string,
  anio: number,
  mes: number,
  metodo: MetodoPago
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ centroId, ninoId, anio, mes, metodo })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()

  const { data: nino, error: ninoErr } = await supabase
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .maybeSingle()
  if (ninoErr || !nino) {
    logger.warn('setMetodoPago nino', ninoErr?.message)
    return fail('cuotas_config.errors.metodo_failed')
  }

  const { data: existente, error: selErr } = await supabase
    .from('metodo_pago_familia')
    .select('id')
    .eq('familia_id', nino.familia_id)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('setMetodoPago select', selErr.message)
    return fail('cuotas_config.errors.metodo_failed')
  }

  const { error } = existente
    ? await supabase.from('metodo_pago_familia').update({ metodo }).eq('id', existente.id)
    : await supabase
        .from('metodo_pago_familia')
        .insert({ centro_id: centroId, familia_id: nino.familia_id, anio, mes, metodo })

  if (error) {
    logger.warn('setMetodoPago upsert', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.metodo_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
