'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { mensajeInputSchema, type MensajeInput } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Envía un mensaje en la conversación del niño. Auto-crea la conversación
 * si no existe (idempotente: el INSERT en conversaciones usa ON CONFLICT
 * (nino_id) DO NOTHING).
 *
 * Validación cliente con Zod; RLS de BD enforza autoría y participación.
 */
export async function enviarMensaje(
  input: MensajeInput
): Promise<ActionResult<{ mensaje_id: string; conversacion_id: string }>> {
  const parsed = mensajeInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  // 1. Localizar o crear conversación. La RLS de conversaciones.INSERT exige
  //    que el usuario sea participante (profe/admin/tutor con permiso).
  const { data: convExistente } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('nino_id', parsed.data.nino_id)
    .maybeSingle()

  let conversacionId = convExistente?.id ?? null

  if (!conversacionId) {
    // centro_id se rellena automáticamente por el trigger BEFORE INSERT
    // (`conversaciones_set_centro_id`). Aquí pasamos un placeholder que la
    // función sobrescribe.
    const { data: convNueva, error: convErr } = await supabase
      .from('conversaciones')
      .insert({
        nino_id: parsed.data.nino_id,
        // Para satisfacer el tipo TS NOT NULL; el trigger BD lo rellena con
        // el centro real derivado del niño. Si la RLS rechaza, no llega a la BD.
        centro_id: '00000000-0000-0000-0000-000000000000',
      })
      .select('id')
      .single()

    if (convErr || !convNueva) {
      logger.warn('enviarMensaje: crear conversación falló', convErr?.message)
      return fail('messages.errors.envio_fallo')
    }
    conversacionId = convNueva.id
  }

  // 2. Insertar el mensaje (autor_id = auth.uid() validado por RLS WITH CHECK).
  const { data: mensaje, error: msgErr } = await supabase
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      autor_id: userId,
      contenido: parsed.data.contenido,
    })
    .select('id')
    .single()

  if (msgErr || !mensaje) {
    logger.warn('enviarMensaje: insertar mensaje falló', msgErr?.message)
    return fail('messages.errors.envio_fallo')
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ mensaje_id: mensaje.id, conversacion_id: conversacionId })
}
