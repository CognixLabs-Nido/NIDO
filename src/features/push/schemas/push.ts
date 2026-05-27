import { z } from 'zod'

/** Input de `suscribir-a-push`. Los tres campos `endpoint`, `p256dh` y `auth`
 *  vienen del `PushSubscription` del navegador
 *  (`PushSubscription.toJSON()`). El `user_agent` es opcional y solo para
 *  diagnóstico/limpieza. */
export const suscribirPushInputSchema = z.object({
  endpoint: z
    .string()
    .url('push.errors.suscripcion_fallo')
    .max(2048, 'push.errors.suscripcion_fallo'),
  p256dh: z
    .string()
    .min(1, 'push.errors.suscripcion_fallo')
    .max(256, 'push.errors.suscripcion_fallo'),
  auth: z.string().min(1, 'push.errors.suscripcion_fallo').max(64, 'push.errors.suscripcion_fallo'),
  user_agent: z.string().max(512).nullable().optional(),
})
export type SuscribirPushInput = z.infer<typeof suscribirPushInputSchema>

/** Input de `desuscribir-push`. Identifica la suscripción por endpoint
 *  (único por usuario, ver UNIQUE en la migración). */
export const desuscribirPushInputSchema = z.object({
  endpoint: z
    .string()
    .url('push.errors.suscripcion_fallo')
    .max(2048, 'push.errors.suscripcion_fallo'),
})
export type DesuscribirPushInput = z.infer<typeof desuscribirPushInputSchema>
