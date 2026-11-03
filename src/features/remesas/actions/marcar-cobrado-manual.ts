'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { claveErrorCobrado } from '../lib/errores-devuelto-cobrado'
import { marcarCobradoManualSchema, type MarcarCobradoManualInput } from '../schemas/remesa'

/**
 * Marca un recibo como cobrado a mano (en efectivo o por transferencia, fuera de SEPA), con la
 * forma, la fecha y una nota opcional (PR-1a), con `marcar_cobrado_manual` (`20261223120000`).
 * Vale para un recibo pendiente que no sea SEPA (un SEPA pendiente va por remesa); el método no se
 * toca. Un devuelto no se cobra aquí: tiene una sola salida y va por `resolverDevolucion` (PR-2).
 * El cheque guardería / ticket restaurant pide su importe y va por `cobrarConCheque` (PR-1b). La
 * función hace todos los rechazos, cada uno con su HINT; hasta esa migración los hacía la app antes
 * de un UPDATE directo, y ahora la BD solo deja cobrar a mano por sus funciones.
 */
export async function marcarCobradoManual(
  input: MarcarCobradoManualInput
): Promise<ActionResult<null>> {
  const parsed = marcarCobradoManualSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, forma, fecha, nota } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc('marcar_cobrado_manual', {
    p_recibo_id: reciboId,
    p_forma: forma,
    p_fecha: fecha,
    // Vacía = sin nota: la función la guarda como NULL.
    p_nota: nota ?? '',
  })
  if (error) {
    const clave = claveErrorCobrado(error)
    if (clave === 'remesas.errors.cobrar_manual_failed')
      logger.warn('marcarCobradoManual error', error.code, error.message)
    return fail(clave)
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
