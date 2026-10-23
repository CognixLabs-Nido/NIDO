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

/** PR-3: el HINT del trigger `recibos_validar_sin_desborde`. */
const DESBORDE_PENDIENTE = 'desborde_pendiente'

/**
 * F-4-4: confirma UN recibo (borrador→pendiente_procesar) vía `confirmar_recibo`. La RPC
 * ancla `cierre_mensual` cuando no queda ningún borrador regular del mes y devuelve `true`
 * si el mes ha quedado cerrado. Solo admin (la RPC lo verifica). PR-3: con un desborde de beca
 * pendiente no se valida (lo rechaza la BD): el exceso es dinero de la familia y se resuelve antes.
 */
export async function confirmarRecibo(
  reciboId: string
): Promise<ActionResult<{ cerrado: boolean }>> {
  const parsed = unoSchema.safeParse({ reciboId })
  if (!parsed.success) return fail('recibos_panel.errors.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('confirmar_recibo', {
    p_recibo_id: parsed.data.reciboId,
  })

  if (error) {
    logger.warn('confirmarRecibo error', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error.hint === DESBORDE_PENDIENTE) return fail('recibos_panel.errors.desborde_pendiente')
    return fail('recibos_panel.errors.confirmar_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ cerrado: data === true })
}

/** Lo que devuelve el lote: los recibos con desborde pendiente se saltan y se listan aparte. */
export interface ResultadoLote {
  confirmados: number
  fallidos: number
  cerrado: boolean
  /** PR-3: ids de los recibos que no se validaron por su desborde de beca pendiente. */
  conDesborde: string[]
}

/**
 * F-4-4: confirma VARIOS recibos en lote (los que la directora ya revisó). Mantiene la
 * semántica «recibo a recibo»: llama `confirmar_recibo` N veces en el servidor. Si el
 * último borrador del mes cae aquí, la RPC ancla el cierre. Devuelve cuántos se
 * confirmaron, cuántos fallaron, cuáles se saltaron por su desborde y si el mes quedó cerrado.
 */
export async function confirmarRecibos(reciboIds: string[]): Promise<ActionResult<ResultadoLote>> {
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
 * ancla el cierre al confirmar el último borrador del mes). Un recibo con desborde de beca
 * pendiente no es un fallo: se salta y se lista aparte (PR-3). Falla solo si no pasó ninguno y
 * tampoco hay ninguno que listar.
 */
export async function confirmarRecibosCore(
  supabase: SupabaseClient<Database>,
  reciboIds: string[]
): Promise<ActionResult<ResultadoLote>> {
  let confirmados = 0
  let fallidos = 0
  let cerrado = false
  const conDesborde: string[] = []

  for (const id of reciboIds) {
    const { data, error } = await supabase.rpc('confirmar_recibo', { p_recibo_id: id })
    if (error) {
      if (error.hint === DESBORDE_PENDIENTE) {
        conDesborde.push(id)
        continue
      }
      logger.warn('confirmarRecibos item', error.message)
      fallidos += 1
      continue
    }
    confirmados += 1
    if (data === true) cerrado = true
  }

  if (confirmados === 0 && conDesborde.length === 0) {
    return fail('recibos_panel.errors.confirmar_failed')
  }
  return ok({ confirmados, fallidos, cerrado, conDesborde })
}
