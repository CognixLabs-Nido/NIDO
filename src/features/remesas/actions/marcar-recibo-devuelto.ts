'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import { claveErrorDevuelto } from '../lib/errores-devuelto-cobrado'
import { marcarReciboDevueltoSchema, type MarcarReciboDevueltoInput } from '../schemas/remesa'

/**
 * Registra la devolución de un recibo enviado al banco (PR-2) con `marcar_recibo_devuelto`
 * (`20261223120000`): la fecha que dice el banco y los gastos que cobra (0 si no hay), conservando
 * `fecha_envio_banco` (las R-transactions referencian el envío original). Los gastos no se suman al
 * recibo: van en la devolución, y la salida que se elija después cobra total + gastos
 * (`resolverDevolucion`). La función hace todos los rechazos (fecha futura o anterior al envío,
 * gastos negativos, un recibo que no está enviado, quien no es Dirección), cada uno con su HINT;
 * hasta esa migración los hacía la app antes de un UPDATE directo, y ahora la BD solo deja pasar
 * un recibo a devuelto por la función.
 */
export async function marcarReciboDevuelto(
  input: MarcarReciboDevueltoInput
): Promise<ActionResult<null>> {
  const parsed = marcarReciboDevueltoSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'remesas.errors.invalid')
  const { reciboId, fecha, gastos_euros } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc('marcar_recibo_devuelto', {
    p_recibo_id: reciboId,
    p_fecha: fecha,
    p_gastos_centimos: eurosACentimos(gastos_euros),
  })
  if (error) {
    const clave = claveErrorDevuelto(error)
    if (clave === 'remesas.errors.devolver_failed')
      logger.warn('marcarReciboDevuelto error', error.code, error.message)
    return fail(clave)
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
