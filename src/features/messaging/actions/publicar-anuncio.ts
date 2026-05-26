'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { logger } from '@/shared/lib/logger'

import { anuncioInputSchema, type AnuncioInput } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Publica un anuncio. RLS WITH CHECK de anuncios.INSERT valida:
 *  - autor_id = auth.uid()
 *  - admin del centro (cualquier ámbito) OR
 *  - profe activo del aula (solo ámbito='aula' con su aula y mismo centro).
 *
 * El server action:
 *  1. Valida Zod (cross-field ámbito ↔ aula).
 *  2. Determina el `centro_id` actual del usuario y el rol.
 *  3. Si rol = profe, fuerza ámbito='aula' (defensa en profundidad ante UI
 *     manipulable). Si rol = admin, permite ambos ámbitos.
 *  4. Inserta. RLS hace la verificación final.
 */
export async function publicarAnuncio(
  input: AnuncioInput
): Promise<ActionResult<{ anuncio_id: string }>> {
  const parsed = anuncioInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('messages.errors.no_autorizado')

  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin' && rol !== 'profe') {
    return fail('messages.errors.no_autorizado')
  }

  // Defensa en profundidad: profe solo puede publicar ámbito='aula'.
  if (rol === 'profe' && parsed.data.ambito === 'centro') {
    return fail('messages.errors.no_autorizado')
  }

  const { data, error } = await supabase
    .from('anuncios')
    .insert({
      autor_id: userId,
      centro_id: centroId,
      ambito: parsed.data.ambito,
      aula_id: parsed.data.aula_id,
      titulo: parsed.data.titulo,
      contenido: parsed.data.contenido,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('publicarAnuncio falló', error?.message)
    return fail('messages.errors.envio_fallo')
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ anuncio_id: data.id })
}
