/* eslint-disable */
// NIDO — Service Worker mínimo de push notifications (Fase 5.5).
//
// Responsabilidades:
//  - Escuchar el evento `push` → renderizar la notificación con el payload
//    enviado por el server.
//  - Escuchar `notificationclick` → cerrar la notificación y abrir/focalizar
//    la URL embebida en data.
//
// Fuera de scope (F11 — PWA completa): caching, offline, sync, etc.
//
// Spec: docs/specs/push-notifications.md
// ADR: docs/decisions/ADR-0027-push-notifications-arquitectura.md

self.addEventListener('install', (event) => {
  // Activa inmediatamente sin esperar a que cierren las pestañas viejas.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Toma control de las pestañas existentes sin recargarlas.
  event.waitUntil(self.clients.claim())
})

// Devuelve un string no vacío o el fallback. Defiende contra payloads
// parseables-pero-malformados (campo null, '', número, ausente) que antes
// sobrescribían los defaults vía spread y producían notificaciones vacías.
function textoSeguro(valor, fallback) {
  return typeof valor === 'string' && valor.trim() ? valor : fallback
}

// Normaliza CUALQUIER entrada (objeto parcial, null, no-objeto) a un payload
// con título/cuerpo/url siempre presentes y `datos` siempre objeto.
function normalizarPayload(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    titulo: textoSeguro(p.titulo, 'NIDO'),
    cuerpo: textoSeguro(p.cuerpo, 'Tienes una notificación nueva'),
    url: textoSeguro(p.url, '/'),
    datos: p.datos && typeof p.datos === 'object' ? p.datos : {},
  }
}

self.addEventListener('push', (event) => {
  // El payload llega como JSON. Si no se puede parsear, intentamos texto plano
  // y, en último término, caemos a defaults — nunca rompemos ni desuscribimos.
  let parsed = null
  if (event.data) {
    try {
      parsed = event.data.json()
    } catch (err) {
      console.error('[sw] no se pudo parsear payload push:', err)
      try {
        parsed = { cuerpo: event.data.text() }
      } catch (_e) {
        parsed = null
      }
    }
  }

  const payload = normalizarPayload(parsed)

  const tag = (payload.datos.conversacion_id || payload.datos.anuncio_id) || undefined

  const options = {
    body: payload.cuerpo,
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    data: { url: payload.url, ...payload.datos },
    tag, // Agrupa notificaciones de la misma conversación/anuncio.
    renotify: Boolean(tag),
    vibrate: [120, 60, 120],
  }

  event.waitUntil(self.registration.showNotification(payload.titulo, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si hay una pestaña abierta de NIDO, la enfocamos y navegamos.
        for (const client of clientList) {
          // `client.url` es absoluto. Comparamos por origen del SW (= origen
          // del despliegue) para no enfocar pestañas de otro origen.
          try {
            const clientUrl = new URL(client.url)
            const swUrl = new URL(self.location.href)
            if (clientUrl.origin === swUrl.origin && 'focus' in client) {
              client.focus()
              if ('navigate' in client) {
                return client.navigate(targetUrl)
              }
              return client
            }
          } catch (_e) {
            // ignorar URLs inválidas
          }
        }
        // Si no hay ninguna pestaña, abrimos una nueva.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
        return null
      })
      .catch((err) => {
        console.error('[sw] notificationclick falló:', err)
      })
  )
})
