#!/usr/bin/env node
/* eslint-disable no-console -- script CLI manual: usamos console.log para feedback al operador */

/**
 * scripts/test-push.mjs — diagnóstico manual de push notifications (Fase 5.5).
 *
 * Envía un push de prueba a TODAS las suscripciones de uno o más usuarios y
 * reporta el código HTTP devuelto por el push service (FCM / Mozilla autopush
 * / Apple APNs Web) para cada endpoint. Útil para distinguir:
 *
 *   200/201           → el push service aceptó el envío. Si el cliente no
 *                       ve la notificación, el problema es downstream (SW,
 *                       payload, navegador, sistema operativo).
 *   403 (forbidden)   → mismatch de VAPID: la suscripción fue creada con
 *                       una public key distinta a la que firma este envío.
 *   404 / 410 (gone)  → suscripción muerta (el navegador la dio de baja).
 *                       NO se borra automáticamente: este script es solo
 *                       diagnóstico.
 *   413               → payload demasiado grande.
 *   429               → rate-limited por el push service.
 *   5xx               → fallo del push service.
 *
 * Pre-requisitos:
 *  - Variables de entorno: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
 *    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (todas en .env.local;
 *    direnv las carga al entrar al directorio del proyecto).
 *  - Las suscripciones a probar deben existir en `push_subscriptions`.
 *
 * Uso:
 *   node scripts/test-push.mjs <uuid> [<uuid> ...]
 *
 * Ejemplo:
 *   node scripts/test-push.mjs 2d7d0594-b40d-47c2-ab63-1d9eac66970a \
 *                              d37702bf-91ba-47dd-93ba-b2d9ef3245de
 *
 * NO modifica ninguna fila (puro diagnóstico). NO interactúa con la app.
 */

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const usuarioIds = process.argv.slice(2).filter(Boolean)
if (usuarioIds.length === 0) {
  console.error('Uso: node scripts/test-push.mjs <usuario_id_uuid> [<usuario_id_uuid> ...]')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const publicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT

const missing = []
if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!publicKey) missing.push('VAPID_PUBLIC_KEY (o NEXT_PUBLIC_VAPID_PUBLIC_KEY)')
if (!privateKey) missing.push('VAPID_PRIVATE_KEY')
if (!subject) missing.push('VAPID_SUBJECT')
if (missing.length > 0) {
  console.error('Faltan variables de entorno:', missing.join(', '))
  console.error('Carga .env.local con direnv o expórtalas a mano antes de ejecutar.')
  process.exit(1)
}

webpush.setVapidDetails(subject, publicKey, privateKey)

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

// Payload de diagnóstico fijo. La forma del payload no afecta al transporte
// (FCM / Mozilla solo cifran y entregan bytes opacos al SW); usamos algo
// simple que el SW de NIDO entiende si llega — y si no llega, el problema
// está antes del SW.
const payload = JSON.stringify({
  title: 'Test push NIDO',
  body: 'Diagnostico F5.5',
  url: '/es/messages',
  conversacion_id: 'test',
})

/** Extrae el host base del endpoint para identificar el push service. */
function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host
  } catch {
    return '?'
  }
}

function clasificarHost(host) {
  if (host.includes('fcm.googleapis.com') || host.includes('android.googleapis.com')) return 'FCM'
  if (host.includes('mozilla.com') || host.includes('mozaws.net')) return 'Mozilla autopush'
  if (host.includes('push.apple.com') || host.includes('icloud.com')) return 'Apple APNs'
  if (host.includes('notify.windows.com') || host.includes('wns.windows.com')) return 'WNS'
  return 'desconocido'
}

let totalOk = 0
let totalFail = 0

for (const usuarioId of usuarioIds) {
  console.log(`\n=== usuario_id: ${usuarioId} ===`)
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_agent, created_at, last_active_at')
    .eq('usuario_id', usuarioId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`  Error cargando suscripciones: ${error.message}`)
    continue
  }
  if (!subs || subs.length === 0) {
    console.log(`  (sin suscripciones registradas)`)
    continue
  }

  console.log(`  ${subs.length} suscripcion(es) encontrada(s).`)
  for (const sub of subs) {
    const host = endpointHost(sub.endpoint)
    const proveedor = clasificarHost(host)
    const created = sub.created_at?.slice(0, 19).replace('T', ' ') ?? '?'
    const uaShort = (sub.user_agent ?? '').slice(0, 60)
    console.log(`  ─ sub ${sub.id}`)
    console.log(`     host        ${host} (${proveedor})`)
    console.log(`     created_at  ${created}`)
    console.log(`     user_agent  ${uaShort}`)
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      const status = res?.statusCode ?? '?'
      console.log(`     resultado   HTTP ${status} (aceptado por el push service)`)
      totalOk++
    } catch (err) {
      const status = err?.statusCode ?? '?'
      const body = err?.body ?? err?.message ?? String(err)
      const headers = err?.headers ? JSON.stringify(err.headers) : ''
      console.log(`     resultado   HTTP ${status} ✗`)
      console.log(
        `     body        ${typeof body === 'string' ? body.trim() : JSON.stringify(body)}`
      )
      if (headers) console.log(`     headers     ${headers}`)
      totalFail++
    }
  }
}

console.log(`\n=== Resumen ===`)
console.log(`  enviados OK : ${totalOk}`)
console.log(`  fallidos    : ${totalFail}`)
console.log(`\n(Este script NO borra suscripciones; lectura/envío puro a fines de diagnóstico.)`)
process.exit(totalFail > 0 ? 1 : 0)
