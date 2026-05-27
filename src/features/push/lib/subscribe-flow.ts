'use client'

import { suscribirAPush } from '../actions/suscribir-a-push'

import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './vapid-key'

export type ActivarPushResult =
  | { ok: true }
  | { ok: false; errorKey: 'permiso_denegado' | 'suscripcion_fallo' }

/**
 * Encapsula el flujo de "pedir permiso → registrar SW → subscribe → persistir
 * en BD". Devuelve un resultado normalizado para que el caller decida cómo
 * mostrarlo (toast, banner, etc.).
 *
 * Pre-condición: el navegador debe soportar Service Worker + PushManager y
 * no estar en estado `denied`. Detección la hace `useNotificationPermission`;
 * el caller comprueba eso antes de invocar este flujo.
 */
export async function activarPush(): Promise<ActivarPushResult> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, errorKey: 'permiso_denegado' }
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey || publicKey === 'your-vapid-public-key') {
    console.error('[activarPush] NEXT_PUBLIC_VAPID_PUBLIC_KEY no configurado')
    return { ok: false, errorKey: 'suscripcion_fallo' }
  }

  try {
    const reg =
      (await navigator.serviceWorker.getRegistration('/sw.js')) ??
      (await navigator.serviceWorker.register('/sw.js'))
    await navigator.serviceWorker.ready

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })

    const json = sub.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    const endpoint = json.endpoint ?? sub.endpoint
    const p256dh = json.keys?.p256dh ?? arrayBufferToBase64Url(sub.getKey('p256dh'))
    const auth = json.keys?.auth ?? arrayBufferToBase64Url(sub.getKey('auth'))

    if (!endpoint || !p256dh || !auth) {
      console.error('[activarPush] suscripción sin claves p256dh/auth')
      return { ok: false, errorKey: 'suscripcion_fallo' }
    }

    const result = await suscribirAPush({
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    })
    if (!result.success) {
      try {
        await sub.unsubscribe()
      } catch {
        // ignorar
      }
      const key = result.error.replace('push.errors.', '')
      return {
        ok: false,
        errorKey: key === 'permiso_denegado' ? 'permiso_denegado' : 'suscripcion_fallo',
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('[activarPush] error inesperado:', err)
    return { ok: false, errorKey: 'suscripcion_fallo' }
  }
}
