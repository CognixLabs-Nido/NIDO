'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

const RUTA = '/[locale]/admin/cuotas'

type MetodoPago = Database['public']['Enums']['metodo_pago']
type Supabase = SupabaseClient<Database>

interface MetodoInput {
  familiaId: string
  anio: number
  mes: number
  metodo: MetodoPago
}

const inputSchema = z.object({
  familiaId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  metodo: z.enum(['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']),
})

/**
 * F-4-4: fija el método de pago de la FAMILIA para el mes (`metodo_pago_familia`, ya grano
 * familia). Evita la trampa del método congelado: el motor congela `recibo.metodo` AL
 * GENERAR, así que si el recibo regular del mes está en BORRADOR se le refleja el cambio
 * con un UPDATE directo (el freeze POR ESTADO lo permite en borrador). Si está confirmado,
 * NO se toca (queda congelado; la UI deshabilita el selector). Solo admin.
 */
export async function setMetodoPagoFamilia(
  familiaId: string,
  anio: number,
  mes: number,
  metodo: MetodoPago
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ familiaId, anio, mes, metodo })
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('recibos_panel.errors.no_autorizado')

  const supabase = await createClient()
  const res = await setMetodoPagoFamiliaCore(supabase, centroId, parsed.data)

  revalidatePath(RUTA, 'page')
  return res
}

/**
 * Núcleo testeable. (1) Upsert de la preferencia de método de la familia/mes. (2) Si el
 * recibo regular del mes está en BORRADOR, refleja el método con un UPDATE directo (el
 * freeze lo permite en borrador); si está CONFIRMADO, NO lo toca (queda congelado).
 */
export async function setMetodoPagoFamiliaCore(
  supabase: Supabase,
  centroId: string,
  input: MetodoInput
): Promise<ActionResult<void>> {
  // 1. Upsert de la preferencia de método de la familia/mes (fuente de futuras generaciones).
  const { data: existente, error: selErr } = await supabase
    .from('metodo_pago_familia')
    .select('id')
    .eq('familia_id', input.familiaId)
    .eq('anio', input.anio)
    .eq('mes', input.mes)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('setMetodoPagoFamilia select', selErr.message)
    return fail('recibos_panel.errors.metodo_failed')
  }

  const { error: upErr } = existente
    ? await supabase.from('metodo_pago_familia').update({ metodo: input.metodo }).eq('id', existente.id)
    : await supabase.from('metodo_pago_familia').insert({
        centro_id: centroId,
        familia_id: input.familiaId,
        anio: input.anio,
        mes: input.mes,
        metodo: input.metodo,
      })

  if (upErr) {
    logger.warn('setMetodoPagoFamilia upsert', upErr.message)
    if (upErr.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    return fail('recibos_panel.errors.metodo_failed')
  }

  // 2. Reflejar en el recibo regular del mes si está en BORRADOR (el freeze lo permite).
  const { data: recibo } = await supabase
    .from('recibos')
    .select('id, estado')
    .eq('centro_id', centroId)
    .eq('familia_id', input.familiaId)
    .eq('anio', input.anio)
    .eq('mes', input.mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (recibo && recibo.estado === 'borrador') {
    const { error: recErr } = await supabase
      .from('recibos')
      .update({ metodo: input.metodo })
      .eq('id', recibo.id)
    if (recErr) {
      logger.warn('setMetodoPagoFamilia recibo', recErr.message)
      // La preferencia ya quedó guardada; el recibo se corregirá al regenerar. No es fatal.
    }
  }

  return ok(undefined)
}
