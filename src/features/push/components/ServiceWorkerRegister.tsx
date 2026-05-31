'use client'

import { useEffect } from 'react'

/**
 * Registra el Service Worker (`/sw.js`) de forma proactiva en cada carga, para
 * todos los roles. Sin esto, el SW solo se registraba dentro del flujo
 * "Activar" de `/profile` (`subscribe-flow.ts`): un usuario que nunca lo
 * completaba no tenía SW vivo y por tanto nunca podía recibir push
 * (`push_subscriptions` quedaba vacía). Ver `docs/specs/reminders-c.md` (F6-C-2)
 * y la auditoría comparativa MisterFC vs NIDO.
 *
 * Idempotente: `register('/sw.js')` con el mismo script es no-op si ya está
 * registrado, así que no duplica el registro que pueda haber hecho
 * `subscribe-flow`.
 *
 * NO pide permiso de notificación ni suscribe a push: eso sigue siendo opt-in
 * del usuario en `/profile`. Aquí solo se registra el SW.
 *
 * A diferencia de MisterFC, NO se limita a producción: registramos también en
 * dev para poder validar el flujo localmente.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // No bloqueamos la app si el SW falla en registrarse; se reintenta en
      // los próximos loads.
      console.error('[ServiceWorkerRegister] registro de /sw.js falló:', err)
    })
  }, [])

  return null
}
