'use server'

import { createClient } from '@/lib/supabase/server'

import { desuscribirPushInputSchema, type DesuscribirPushInput } from '../schemas/push'
import { fail, ok, type ActionResult } from '../types'

/**
 * Elimina la suscripción push del usuario autenticado para el endpoint dado.
 *
 * Idempotente: si la fila no existe, devuelve `success: true` con `removed: 0`.
 * Esto cubre el caso "el cliente llama desuscribir pero su token ya había sido
 * limpiado por el helper de envío al recibir un 410".
 *
 * Errores tipados (i18n keys de `push.errors.*`):
 *  - `no_autorizado`: sin sesión.
 *  - `suscripcion_fallo`: error inesperado.
 */
export async function desuscribirPush(
  input: DesuscribirPushInput
): Promise<ActionResult<{ removed: number }>> {
  const parsed = desuscribirPushInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'push.errors.suscripcion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('push.errors.no_autorizado')

  const { error, count } = await supabase
    .from('push_subscriptions')
    .delete({ count: 'exact' })
    .eq('usuario_id', userId)
    .eq('endpoint', parsed.data.endpoint)

  if (error) {
    console.error('[desuscribirPush] delete falló:', error)
    return fail('push.errors.suscripcion_fallo')
  }

  return ok({ removed: count ?? 0 })
}
