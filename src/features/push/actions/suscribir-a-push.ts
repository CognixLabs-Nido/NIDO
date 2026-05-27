'use server'

import { createClient } from '@/lib/supabase/server'

import { suscribirPushInputSchema, type SuscribirPushInput } from '../schemas/push'
import { fail, ok, type ActionResult } from '../types'

/**
 * Registra (o refresca) la suscripción push del usuario autenticado para el
 * endpoint que le ha asignado el servicio push del navegador.
 *
 * Upsert por `(usuario_id, endpoint)`: si el cliente reintenta la suscripción
 * (p. ej. tras cambiar `p256dh`/`auth` o tras un cambio de VAPID), la fila
 * existente se actualiza en lugar de duplicarse.
 *
 * Errores tipados (i18n keys de `push.errors.*`):
 *  - `no_autorizado`: sin sesión.
 *  - `suscripcion_fallo`: error inesperado (último recurso). Va con
 *    `console.error` server-side.
 */
export async function suscribirAPush(
  input: SuscribirPushInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = suscribirPushInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'push.errors.suscripcion_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('push.errors.no_autorizado')

  // UPSERT por (usuario_id, endpoint). En conflicto refrescamos p256dh, auth,
  // user_agent y last_active_at. El trigger BEFORE UPDATE toca updated_at.
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        usuario_id: userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        user_agent: parsed.data.user_agent ?? null,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'usuario_id,endpoint' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error('[suscribirAPush] upsert falló:', error)
    return fail('push.errors.suscripcion_fallo')
  }

  return ok({ id: data.id })
}
