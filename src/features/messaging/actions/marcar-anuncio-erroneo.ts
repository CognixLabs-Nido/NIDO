'use server'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { VENTANA_ANULACION_MS } from '../lib/constants'
import { marcarAnuncioErroneoSchema } from '../schemas/messaging'
import { fail, ok, PREFIX_ANULADO, type ActionResult } from '../types'

/**
 * Marca un anuncio como erróneo. Mismo patrón que mensajes: UPDATE
 * `erroneo=true` + prefijo `[anulado] ` en `titulo` (el contenido
 * permanece visible para preservar trazabilidad).
 *
 * RLS exige `autor_id = auth.uid()` Y
 * `created_at > now() - interval '5 minutes'` (F5.6-B). Si USING
 * rechaza el UPDATE, Postgres devuelve "0 filas afectadas, error null"
 * — no un 42501. Por eso pedimos `.select('id').maybeSingle()` y
 * mapeamos `null` a `ventana_anulacion_expirada`. El handler 42501
 * queda como defensa en profundidad.
 */
export async function marcarAnuncioErroneo(input: {
  anuncio_id: string
}): Promise<ActionResult<{ anuncio_id: string }>> {
  const parsed = marcarAnuncioErroneoSchema.safeParse(input)
  if (!parsed.success) {
    return fail('messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const result = await marcarAnuncioErroneoCore(supabase, userId, parsed.data.anuncio_id)
  if (result.success) {
    revalidatePath('/[locale]/messages', 'layout')
  }
  return result
}

/**
 * Núcleo testeable: recibe el cliente Supabase y el `userId` explícitos. La
 * variante pública wireá `createClient()` + `auth.getUser()` desde el
 * contexto Next.js. Los tests inyectan un fake; los tests de integración
 * usarían `clientFor(testUser)` del harness RLS.
 *
 * No depende de `revalidatePath` ni del runtime de server actions.
 */
export async function marcarAnuncioErroneoCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  anuncioId: string
): Promise<ActionResult<{ anuncio_id: string }>> {
  const { data: anuncio, error: selErr } = await supabase
    .from('anuncios')
    .select('id, autor_id, titulo, erroneo, created_at')
    .eq('id', anuncioId)
    .maybeSingle()

  if (selErr || !anuncio) return fail('messages.errors.no_autorizado')
  if (anuncio.autor_id !== userId) return fail('messages.errors.no_autorizado')
  if (anuncio.erroneo) return fail('messages.errors.ya_anulado')

  const ageMs = Date.now() - new Date(anuncio.created_at).getTime()
  if (ageMs > VENTANA_ANULACION_MS) {
    return fail('messages.errors.ventana_anulacion_expirada')
  }

  const nuevoTitulo = anuncio.titulo.startsWith(PREFIX_ANULADO)
    ? anuncio.titulo
    : `${PREFIX_ANULADO}${anuncio.titulo}`

  const { data: updated, error: updErr } = await supabase
    .from('anuncios')
    .update({ erroneo: true, titulo: nuevoTitulo })
    .eq('id', anuncioId)
    .select('id')
    .maybeSingle()

  if (updErr) {
    if (updErr.code === '42501') {
      return fail('messages.errors.ventana_anulacion_expirada')
    }
    logger.warn('marcarAnuncioErroneo falló', updErr.message)
    return fail('messages.errors.envio_fallo')
  }
  if (!updated) {
    // RLS rechazó por USING (típicamente: ventana expiró entre SELECT y UPDATE).
    return fail('messages.errors.ventana_anulacion_expirada')
  }

  return ok({ anuncio_id: anuncioId })
}
