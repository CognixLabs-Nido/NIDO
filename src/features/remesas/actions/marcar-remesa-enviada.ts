'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { claveErrorMarcarEnviada } from '../lib/errores-marcar-enviada'
import { marcarRemesaEnviadaSchema, type MarcarRemesaEnviadaInput } from '../schemas/remesa'

/**
 * Marca una remesa BORRADOR como ENVIADA con `marcar_remesa_enviada` (R-4, `20261221120000`), en
 * una transacción y con la sesión de Dirección (la función mira `es_admin` del centro de la
 * remesa). Exige el fichero de su versión guardado y que sus recibos cobrables sean los del
 * fichero; pasan a `enviado_banco` solo esos, con la fecha de Madrid. Hasta R-4 la app hacía dos
 * UPDATE (la remesa y, en otra llamada, los recibos) y, si fallaba el segundo, la remesa quedaba
 * enviada con los recibos pendientes; ahora la BD solo deja pasarla a enviada por la función.
 */
export async function marcarRemesaEnviada(
  input: MarcarRemesaEnviadaInput
): Promise<ActionResult<null>> {
  const parsed = marcarRemesaEnviadaSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const supabase = await createClient()
  const { error } = await supabase.rpc('marcar_remesa_enviada', {
    p_remesa_id: parsed.data.remesaId,
  })
  if (error) {
    const clave = claveErrorMarcarEnviada(error)
    if (clave === 'remesas.errors.enviar_failed')
      logger.warn('marcarRemesaEnviada error', error.code, error.message)
    return fail(clave)
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok(null)
}
