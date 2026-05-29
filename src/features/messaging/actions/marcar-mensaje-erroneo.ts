'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { VENTANA_ANULACION_MS } from '../lib/constants'
import { marcarMensajeErroneoSchema } from '../schemas/messaging'
import { fail, ok, PREFIX_ANULADO, type ActionResult } from '../types'

/**
 * Marca un mensaje como erróneo. Mismo patrón que F3/F4: UPDATE con flag
 * `erroneo=true` + prefijo `[anulado] ` en `contenido`. Idempotente: si ya
 * estaba marcado, devuelve error tipado para que la UI muestre el toast
 * correcto sin doble-anular.
 *
 * RLS de mensajes.UPDATE exige `autor_id = auth.uid()` Y
 * `created_at > now() - interval '5 minutes'` (F5.6-B). El pre-check de
 * 5 min en la action es UX rápida; ojo: si USING rechaza, Postgres
 * devuelve "0 filas afectadas, error null" — NO un 42501. Por eso
 * pedimos `.select('id').maybeSingle()` y, si vuelve null, mapeamos a
 * `ventana_anulacion_expirada`. El handler de 42501 se mantiene como
 * defensa en profundidad.
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

  const result = await marcarMensajeErroneoCore(supabase, userId, parsed.data.mensaje_id)
  if (result.success) {
    revalidatePath('/[locale]/messages', 'layout')
  }
  return result
}

/**
 * Núcleo testeable: recibe el cliente Supabase y el `userId` explícitos. La
 * variante pública wireá `createClient()` + `auth.getUser()` desde el
 * contexto Next.js. Los tests unitarios inyectan un fake; los tests de
 * integración usan `clientFor(testUser)` del harness RLS.
 *
 * No depende de `revalidatePath` ni del runtime de server actions.
 */
export async function marcarMensajeErroneoCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  mensajeId: string
): Promise<ActionResult<{ mensaje_id: string }>> {
  const { data: msg, error: selErr } = await supabase
    .from('mensajes')
    .select('id, autor_id, contenido, erroneo, created_at')
    .eq('id', mensajeId)
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

  const ageMs = Date.now() - new Date(msg.created_at).getTime()
  if (ageMs > VENTANA_ANULACION_MS) {
    return fail('messages.errors.ventana_anulacion_expirada')
  }

  const nuevoContenido = msg.contenido.startsWith(PREFIX_ANULADO)
    ? msg.contenido
    : `${PREFIX_ANULADO}${msg.contenido}`

  const { data: updated, error: updErr } = await supabase
    .from('mensajes')
    .update({ erroneo: true, contenido: nuevoContenido })
    .eq('id', mensajeId)
    .select('id')
    .maybeSingle()

  if (updErr) {
    if (updErr.code === '42501') {
      return fail('messages.errors.ventana_anulacion_expirada')
    }
    logger.warn('marcarMensajeErroneo falló', updErr.message)
    return fail('messages.errors.envio_fallo')
  }
  if (!updated) {
    // RLS rechazó por USING (típicamente: ventana expiró entre SELECT y UPDATE).
    return fail('messages.errors.ventana_anulacion_expirada')
  }

  return ok({ mensaje_id: mensajeId })
}
