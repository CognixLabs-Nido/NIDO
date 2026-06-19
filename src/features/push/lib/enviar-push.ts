import webpush from 'web-push'

import { createServiceRoleClient } from '@/features/auth/actions/_service-role'

import type { PushPayload, PushSubscriptionRow } from '../types'

let vapidConfigured = false
let vapidWarned = false

/** Configura `web-push` con las VAPID keys del entorno la primera vez que
 *  se llama. Devuelve `false` si faltan claves (dev local sin .env.local
 *  configurado). En ese caso el helper no envía nada — la operación de
 *  mensajería sigue funcionando, simplemente sin push. */
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true

  // La clave pública vive en dos sitios por la convención de Next.js:
  // `NEXT_PUBLIC_VAPID_PUBLIC_KEY` para que el navegador la lea al hacer
  // `pushManager.subscribe`, y `VAPID_PUBLIC_KEY` (mismo valor) para el
  // server. Preferimos la versión server-only; si falta, caemos a la pública.
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    if (!vapidWarned) {
      console.error(
        '[enviarPush] VAPID keys ausentes (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT). Saltando envío.'
      )
      vapidWarned = true
    }
    return false
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

interface SendResultInternal {
  subscriptionId: string
  status: 'ok' | 'gone' | 'error'
  error?: unknown
}

/** Envía un push a UNA suscripción concreta. Encapsula el manejo de errores y
 *  expone solo un resultado normalizado al caller. */
async function enviarUno(
  sub: PushSubscriptionRow,
  payload: PushPayload
): Promise<SendResultInternal> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload)
    )
    return { subscriptionId: sub.id, status: 'ok' }
  } catch (err) {
    // WebPushError tiene statusCode con el código del endpoint push.
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) {
      return { subscriptionId: sub.id, status: 'gone', error: err }
    }
    return { subscriptionId: sub.id, status: 'error', error: err }
  }
}

/**
 * Envía una notificación push a todas las suscripciones de los usuarios dados.
 *
 * - Usa el **service role client** para leer `push_subscriptions` cross-user
 *   (la RLS exige `usuario_id = auth.uid()` y el caller no es necesariamente
 *   el destinatario).
 * - Paraleliza envíos con `Promise.allSettled`: un fallo en un endpoint no
 *   bloquea al resto.
 * - Limpia automáticamente las suscripciones que reciben **410 Gone**
 *   (el endpoint ya no está activo) o **404 Not Found** (algunos servicios
 *   devuelven 404 en su lugar).
 * - **No lanza nunca**: cualquier error queda en `console.error` y la función
 *   resuelve con el resumen. Esto es intencional — el caller (server action
 *   de mensajería) no debe fallar la operación principal si el push falla.
 *
 * @param usuarioIds  Lista de UUIDs de destinatarios.
 * @param payload     Contenido y URL para el `notificationclick` del SW.
 * @returns Resumen con conteos por estado. Útil para tests y logging.
 */
export async function enviarPushANotificarUsuarios(
  usuarioIds: string[],
  payload: PushPayload
): Promise<{ enviados: number; expirados: number; errores: number; total: number }> {
  if (usuarioIds.length === 0) {
    return { enviados: 0, expirados: 0, errores: 0, total: 0 }
  }

  if (!ensureVapidConfigured()) {
    return { enviados: 0, expirados: 0, errores: 0, total: 0 }
  }

  const supabase = createServiceRoleClient()

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select(
      'id, usuario_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, last_active_at'
    )
    .in('usuario_id', usuarioIds)

  if (error) {
    console.error('[enviarPush] cargar suscripciones falló:', error)
    return { enviados: 0, expirados: 0, errores: 0, total: 0 }
  }

  if (!subs || subs.length === 0) {
    return { enviados: 0, expirados: 0, errores: 0, total: 0 }
  }

  const results = await Promise.allSettled(subs.map((s) => enviarUno(s, payload)))

  let enviados = 0
  let expirados = 0
  let errores = 0
  const idsAExpirar: string[] = []

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      errores++
      console.error('[enviarPush] envío rechazado de forma inesperada:', r.reason)
      continue
    }
    if (r.value.status === 'ok') {
      enviados++
    } else if (r.value.status === 'gone') {
      expirados++
      idsAExpirar.push(r.value.subscriptionId)
    } else {
      errores++
      console.error(
        '[enviarPush] error al enviar a suscripción',
        r.value.subscriptionId,
        r.value.error
      )
    }
  }

  if (idsAExpirar.length > 0) {
    const { error: delErr } = await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', idsAExpirar)
    if (delErr) {
      console.error('[enviarPush] limpiar suscripciones expiradas falló:', delErr)
    }
  }

  return { enviados, expirados, errores, total: subs.length }
}
