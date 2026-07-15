'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

const RUTA = '/[locale]/admin/cuotas'

const unoSchema = z.object({ reciboId: z.string().uuid() })
const loteSchema = z.object({ reciboIds: z.array(z.string().uuid()).min(1).max(500) })

/**
 * F-4-4: confirma UN recibo (borrador→pendiente_procesar) vía `confirmar_recibo`. La RPC
 * ancla `cierre_mensual` cuando no queda ningún borrador regular del mes y devuelve `true`
 * si el mes ha quedado cerrado. Solo admin (la RPC lo verifica).
 */
export async function confirmarRecibo(reciboId: string): Promise<ActionResult<{ cerrado: boolean }>> {
  const parsed = unoSchema.safeParse({ reciboId })
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('confirmar_recibo', { p_recibo_id: parsed.data.reciboId })

  if (error) {
    logger.warn('confirmarRecibo error', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    return fail('recibos_panel.errors.confirmar_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ cerrado: data === true })
}

/**
 * F-4-4: confirma VARIOS recibos en lote (los que la directora ya revisó). Mantiene la
 * semántica «recibo a recibo»: llama `confirmar_recibo` N veces en el servidor. Si el
 * último borrador del mes cae aquí, la RPC ancla el cierre. Devuelve cuántos se
 * confirmaron, cuántos fallaron y si el mes quedó cerrado.
 */
export async function confirmarRecibos(
  reciboIds: string[]
): Promise<ActionResult<{ confirmados: number; fallidos: number; cerrado: boolean }>> {
  const parsed = loteSchema.safeParse({ reciboIds })
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const supabase = await createClient()
  const res = await confirmarRecibosCore(supabase, parsed.data.reciboIds)

  revalidatePath(RUTA, 'page')
  return res
}

/**
 * Núcleo testeable: llama `confirmar_recibo` una vez por id (semántica recibo-a-recibo).
 * Cuenta confirmados/fallidos y marca `cerrado` si alguna llamada devolvió `true` (la RPC
 * ancla el cierre al confirmar el último borrador del mes). Falla solo si NINGUNO pasó.
 */
export async function confirmarRecibosCore(
  supabase: SupabaseClient<Database>,
  reciboIds: string[]
): Promise<ActionResult<{ confirmados: number; fallidos: number; cerrado: boolean }>> {
  let confirmados = 0
  let fallidos = 0
  let cerrado = false

  for (const id of reciboIds) {
    const { data, error } = await supabase.rpc('confirmar_recibo', { p_recibo_id: id })
    if (error) {
      logger.warn('confirmarRecibos item', error.message)
      fallidos += 1
      continue
    }
    confirmados += 1
    if (data === true) cerrado = true
  }

  if (confirmados === 0) return fail('recibos_panel.errors.confirmar_failed')
  return ok({ confirmados, fallidos, cerrado })
}
