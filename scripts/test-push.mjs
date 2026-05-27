#!/usr/bin/env node
/* eslint-disable no-console -- script CLI manual: usamos console.log para feedback al operador */

/**
 * scripts/test-push.mjs — envío manual de push de prueba (Fase 5.5 smoke).
 *
 * Lee las suscripciones de un usuario concreto y le envía una notificación
 * de prueba. No depende del código de la app — sólo de las VAPID keys y de
 * la SUPABASE_SERVICE_ROLE_KEY en el entorno.
 *
 * Pre-requisitos:
 *  - Migración `phase5_5_push_subscriptions` aplicada al remoto.
 *  - VAPID keys generadas y en .env.local (NEXT_PUBLIC_VAPID_PUBLIC_KEY,
 *    VAPID_PRIVATE_KEY, VAPID_SUBJECT).
 *  - El usuario destino debe haber pulsado "Activar notificaciones" en
 *    `/profile` desde un navegador con permisos concedidos (existe fila en
 *    `push_subscriptions` para él).
 *
 * Uso:
 *   node scripts/test-push.mjs <usuario_id_uuid>
 *
 * El script:
 *  1. Carga las variables de .env.local (vía direnv, debes ejecutarlo dentro
 *     del directorio del proyecto con direnv cargado).
 *  2. Pide a Supabase las suscripciones de ese usuario.
 *  3. Envía un push a cada una con payload de demo.
 *  4. Si recibe 410/404, elimina la fila.
 */

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const usuarioId = process.argv[2]
if (!usuarioId) {
  console.error('Uso: node scripts/test-push.mjs <usuario_id_uuid>')
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

const { data: subs, error } = await supabase
  .from('push_subscriptions')
  .select('id, endpoint, p256dh, auth')
  .eq('usuario_id', usuarioId)

if (error) {
  console.error('Error cargando suscripciones:', error.message)
  process.exit(1)
}

if (!subs || subs.length === 0) {
  console.log(`Usuario ${usuarioId} no tiene suscripciones push activas.`)
  process.exit(0)
}

console.log(`Encontradas ${subs.length} suscripcion(es). Enviando push de prueba…`)

const payload = JSON.stringify({
  titulo: 'NIDO — push de prueba',
  cuerpo: 'Si ves esto en tu dispositivo, la integración funciona ✅',
  url: '/es/messages',
  datos: { tipo: 'test', timestamp: Date.now().toString() },
})

let okCount = 0
let goneCount = 0
let errorCount = 0
const idsAExpirar = []

for (const sub of subs) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload
    )
    console.log(`  ✓ ${sub.id} — enviado`)
    okCount++
  } catch (err) {
    const statusCode = err?.statusCode
    if (statusCode === 410 || statusCode === 404) {
      console.log(`  ⚠ ${sub.id} — endpoint expirado (${statusCode}), eliminando`)
      idsAExpirar.push(sub.id)
      goneCount++
    } else {
      console.error(`  ✗ ${sub.id} — error ${statusCode ?? '?'}:`, err?.message ?? err)
      errorCount++
    }
  }
}

if (idsAExpirar.length > 0) {
  const { error: delErr } = await supabase.from('push_subscriptions').delete().in('id', idsAExpirar)
  if (delErr) {
    console.error('Error eliminando suscripciones expiradas:', delErr.message)
  }
}

console.log(`\nResumen: enviados=${okCount} expirados=${goneCount} errores=${errorCount}`)
process.exit(errorCount > 0 ? 1 : 0)
