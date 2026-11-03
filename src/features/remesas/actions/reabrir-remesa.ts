'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { claveErrorReabrir } from '../lib/errores-reabrir'
import { reabrirRemesaSchema, type ReabrirRemesaInput } from '../schemas/remesa'

/**
 * Reabre una remesa con `reabrir_remesa` (`20261227120000`), con la sesión de la admin del centro
 * (la función mira `privado.es_titular`: ni la directora ni el superusuario). Pasa el número de
 * recibos y el importe que enseñó el aviso: si la remesa cambió entre medias, la BD no reabre y
 * la admin vuelve a ver los números de ahora. La remesa vuelve a borrador; sus recibos enviados, a
 * pendiente; los devueltos y los cobrados a mano no se tocan; el fichero anterior se queda guardado
 * y la próxima descarga saldrá con otro identificador. Devuelve cuántos recibos volvieron a
 * pendiente, o `null` si la respuesta no lo trae (el aviso lo dice sin número, no con un cero).
 */
export async function reabrirRemesa(
  input: ReabrirRemesaInput
): Promise<ActionResult<{ nAPendiente: number | null }>> {
  const parsed = reabrirRemesaSchema.safeParse(input)
  if (!parsed.success) return fail('remesas.errors.invalid')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reabrir_remesa', {
    p_remesa_id: parsed.data.remesaId,
    p_n_recibos: parsed.data.nRecibos,
    p_total_centimos: parsed.data.totalCentimos,
  })
  if (error) {
    const clave = claveErrorReabrir(error)
    if (clave === 'remesas.errors.reabrir_failed')
      logger.warn('reabrirRemesa error', error.code, error.message)
    return fail(clave)
  }

  revalidatePath('/[locale]/admin/cuotas', 'page')
  const n = (data as { n_a_pendiente?: unknown } | null)?.n_a_pendiente
  return ok({ nAPendiente: typeof n === 'number' ? n : null })
}
