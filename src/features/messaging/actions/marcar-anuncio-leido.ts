'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarAnuncioLeidoSchema } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Marca un anuncio como leído para el usuario actual. INSERT idempotente
 * en `lectura_anuncio` (UNIQUE (usuario_id, anuncio_id)).
 *
 * RLS exige que el usuario sea audiencia del anuncio
 * (`usuario_es_audiencia_anuncio(anuncio_id)`); el autor también puede
 * marcarlo leído aunque la UI no muestra esa opción.
 */
export async function marcarAnuncioLeido(input: {
  anuncio_id: string
}): Promise<ActionResult<void>> {
  const parsed = marcarAnuncioLeidoSchema.safeParse(input)
  if (!parsed.success) return fail('messages.errors.envio_fallo')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const { error } = await supabase.from('lectura_anuncio').upsert(
    {
      usuario_id: userId,
      anuncio_id: parsed.data.anuncio_id,
      leido_at: new Date().toISOString(),
    },
    { onConflict: 'usuario_id,anuncio_id' }
  )

  if (error) {
    logger.warn('marcarAnuncioLeido falló', error.message)
    return fail('messages.errors.envio_fallo')
  }
  return ok(undefined)
}
