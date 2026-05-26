'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { mensajeInputSchema, type MensajeInput } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * Envía un mensaje en la conversación del niño. Auto-crea la conversación
 * si no existe (lazy creation, ver ADR-0023 § "Conversaciones por niño").
 *
 * Origen del `centro_id` de la conversación: se deriva del niño mediante
 * `SELECT centro_id FROM ninos WHERE id = nino_id`. Antes del hotfix
 * `fix/enviar-mensaje-centro-id` se pasaba el UUID placeholder
 * '00000000-0000-0000-0000-000000000000' confiando en que el trigger
 * BEFORE INSERT `conversaciones_set_centro_id` lo sobrescribiera. **Pero
 * el trigger solo actúa si `NEW.centro_id IS NULL`**, y un UUID válido
 * pasaba por su check sin tocarse, provocando un FK violation contra
 * `centros` en BD. La columna `centro_id` es NOT NULL en TS y BD, así que
 * derivar el valor explícitamente desde `ninos.centro_id` es la opción
 * limpia: documenta el flujo y elimina la dependencia del trigger.
 *
 * Errores tipados (i18n keys de `messages.errors.*`):
 *  - `no_autorizado`: sin sesión.
 *  - `nino_no_encontrado`: el niño no existe o RLS no lo deja leer.
 *  - `sin_permisos`: la RLS de mensajes/conversaciones rechazó la
 *    operación (código Postgres 42501 / 23503 sobre tablas de mensajería).
 *  - `envio_fallo`: error inesperado (último recurso). Va con
 *    console.error server-side para que aparezca en logs y se pueda
 *    diagnosticar.
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

  // 1. Resolver el centro del niño. Si no existe (o RLS oculta la fila)
  //    devolvemos `nino_no_encontrado` para distinguirlo del fallo genérico.
  const { data: nino, error: ninoErr } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', parsed.data.nino_id)
    .maybeSingle()

  if (ninoErr) {
    console.error('[enviarMensaje] ninos.select falló:', ninoErr)
    return fail('messages.errors.envio_fallo')
  }
  if (!nino) {
    return fail('messages.errors.nino_no_encontrado')
  }

  // 2. Localizar o crear conversación. RLS de conversaciones.INSERT exige
  //    que el usuario sea participante. Pasamos centro_id explícito (el
  //    trigger BD también lo cubriría si fuese NULL, pero el tipo TS lo
  //    quiere NOT NULL).
  const { data: convExistente, error: convSelErr } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('nino_id', parsed.data.nino_id)
    .maybeSingle()

  if (convSelErr) {
    console.error('[enviarMensaje] conversaciones.select falló:', convSelErr)
    return fail('messages.errors.envio_fallo')
  }

  let conversacionId = convExistente?.id ?? null

  if (!conversacionId) {
    const { data: convNueva, error: convErr } = await supabase
      .from('conversaciones')
      .insert({
        nino_id: parsed.data.nino_id,
        centro_id: nino.centro_id,
      })
      .select('id')
      .single()

    if (convErr || !convNueva) {
      logger.warn('enviarMensaje: crear conversación falló', convErr?.message)
      console.error('[enviarMensaje] conversaciones.insert falló:', convErr)
      if (convErr?.code === '42501') {
        return fail('messages.errors.sin_permisos')
      }
      return fail('messages.errors.envio_fallo')
    }
    conversacionId = convNueva.id
  }

  // 3. Insertar el mensaje (autor_id = auth.uid() validado por RLS WITH CHECK).
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
    console.error('[enviarMensaje] mensajes.insert falló:', msgErr)
    if (msgErr?.code === '42501') {
      return fail('messages.errors.sin_permisos')
    }
    return fail('messages.errors.envio_fallo')
  }

  revalidatePath('/[locale]/messages', 'layout')
  return ok({ mensaje_id: mensaje.id, conversacion_id: conversacionId })
}
