'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarMensajeErroneoSchema } from '../schemas/messaging'
import { fail, ok, PREFIX_ANULADO, type ActionResult } from '../types'

/**
 * Marca un mensaje como erróneo. Mismo patrón que F3/F4: UPDATE con flag
 * `erroneo=true` + prefijo `[anulado] ` en `contenido`. Idempotente: si ya
 * estaba marcado, devuelve error tipado para que la UI muestre el toast
 * correcto sin doble-anular.
 *
 * RLS de mensajes.UPDATE exige `autor_id = auth.uid()` — solo el autor
 * puede anular su mensaje. El server action no permite modificar el
 * contenido a otra cosa que el prefijo; cualquier otra mutación se
 * detectaría como bug si llegase aquí.
 */
export async function marcarMensajeErroneo(input: {
  mensaje_id: string
}): Promise<ActionResult<{ mensaje_id: string }>> {
  const parsed = marcarMensajeErroneoSchema.safeParse(input)
  if (!parsed.success) {
    return fail('messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const { data: msg, error: selErr } = await supabase
    .from('mensajes')
    .select('id, autor_id, contenido, erroneo')
    .eq('id', parsed.data.mensaje_id)
    .maybeSingle()

  if (selErr || !msg) {
    return fail('messages.errors.no_autorizado')
  }
  if (msg.autor_id !== userId) {
    return fail('messages.errors.no_autorizado')
  }
  if (msg.erroneo) {
    return fail('messages.errors.ya_anulado')
  }

  const nuevoContenido = msg.contenido.startsWith(PREFIX_ANULADO)
    ? msg.contenido
    : `${PREFIX_ANULADO}${msg.contenido}`

  const { error: updErr } = await supabase
    .from('mensajes')
    .update({ erroneo: true, contenido: nuevoContenido })
    .eq('id', parsed.data.mensaje_id)

  if (updErr) {
    logger.warn('marcarMensajeErroneo falló', updErr.message)
    return fail('messages.errors.envio_fallo')
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ mensaje_id: parsed.data.mensaje_id })
}
