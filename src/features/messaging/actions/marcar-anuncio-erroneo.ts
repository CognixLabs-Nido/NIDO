'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarAnuncioErroneoSchema } from '../schemas/messaging'
import { fail, ok, PREFIX_ANULADO, type ActionResult } from '../types'

/**
 * Marca un anuncio como erróneo. Mismo patrón que mensajes: UPDATE
 * `erroneo=true` + prefijo `[anulado] ` en `titulo` (el contenido
 * permanece visible para preservar trazabilidad).
 *
 * RLS exige `autor_id = auth.uid()`.
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

  const { data: anuncio, error: selErr } = await supabase
    .from('anuncios')
    .select('id, autor_id, titulo, erroneo')
    .eq('id', parsed.data.anuncio_id)
    .maybeSingle()

  if (selErr || !anuncio) return fail('messages.errors.no_autorizado')
  if (anuncio.autor_id !== userId) return fail('messages.errors.no_autorizado')
  if (anuncio.erroneo) return fail('messages.errors.ya_anulado')

  const nuevoTitulo = anuncio.titulo.startsWith(PREFIX_ANULADO)
    ? anuncio.titulo
    : `${PREFIX_ANULADO}${anuncio.titulo}`

  const { error: updErr } = await supabase
    .from('anuncios')
    .update({ erroneo: true, titulo: nuevoTitulo })
    .eq('id', parsed.data.anuncio_id)

  if (updErr) {
    logger.warn('marcarAnuncioErroneo falló', updErr.message)
    return fail('messages.errors.envio_fallo')
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ anuncio_id: parsed.data.anuncio_id })
}
