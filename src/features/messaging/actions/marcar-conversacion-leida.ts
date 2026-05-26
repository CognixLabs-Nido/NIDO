'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { marcarConversacionLeidaSchema } from '../schemas/messaging'
import { fail, ok, type ActionResult } from '../types'

/**
 * UPSERT en `lectura_conversacion` para registrar que el usuario ha leído
 * hasta `now()` esta conversación. Idempotente: si ya hay fila, UPDATE.
 *
 * RLS solo permite escribir filas con `usuario_id = auth.uid()`.
 *
 * **Importante para el badge global** (bug post-F5): esta action no toca
 * `revalidatePath` porque revalidar el layout entero en cada UPSERT es
 * caro. En su lugar, el cliente que llama (ej. `ConversacionView` o
 * `ConversacionesSplitView`) debe hacer `router.refresh()` tras la
 * respuesta exitosa para forzar la recomputación SSR de
 * `countNoLeidos()` y bajar el `MessagingBadge`. El realtime hook NO
 * escucha `lectura_conversacion` (no está en `supabase_realtime`), así
 * que la única fuente de actualización del badge tras leer es el
 * `router.refresh()` explícito desde el caller.
 */
export async function marcarConversacionLeida(input: {
  conversacion_id: string
}): Promise<ActionResult<void>> {
  const parsed = marcarConversacionLeidaSchema.safeParse(input)
  if (!parsed.success) {
    return fail('messages.errors.envio_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('messages.errors.no_autorizado')

  const { error } = await supabase.from('lectura_conversacion').upsert(
    {
      usuario_id: userId,
      conversacion_id: parsed.data.conversacion_id,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'usuario_id,conversacion_id' }
  )

  if (error) {
    logger.warn('marcarConversacionLeida falló', error.message)
    return fail('messages.errors.envio_fallo')
  }
  return ok(undefined)
}
