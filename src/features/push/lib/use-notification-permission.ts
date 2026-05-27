'use client'

import { useCallback, useEffect, useState } from 'react'

export type PushStatus =
  | 'loading'
  | 'unsupported'
  | 'ios_sin_pwa'
  | 'denied'
  | 'default'
  | 'granted'

interface PermissionState {
  status: PushStatus
  hasSubscription: boolean | null
}

interface UseNotificationPermissionResult extends PermissionState {
  refresh: () => Promise<void>
}

/** Lee el estado actual del soporte push del navegador sin tocar React.
 *  Aislar en una función pura facilita testing y permite que el hook
 *  setee el estado una única vez desde el efecto (cumple la regla
 *  `react-hooks/set-state-in-effect`, que se queja del setState
 *  síncrono distribuido en varias ramas). */
async function leerEstado(): Promise<PermissionState> {
  if (typeof window === 'undefined') {
    return { status: 'loading', hasSubscription: null }
  }

  const supportsSW = 'serviceWorker' in navigator
  const supportsNotif = 'Notification' in window
  const supportsPush = 'PushManager' in window

  if (!supportsSW || !supportsNotif || !supportsPush) {
    return { status: 'unsupported', hasSubscription: null }
  }

  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  if (isIOS && !isStandalone) {
    return { status: 'ios_sin_pwa', hasSubscription: null }
  }

  const permission = Notification.permission
  if (permission === 'denied') {
    return { status: 'denied', hasSubscription: null }
  }
  if (permission !== 'granted') {
    return { status: 'default', hasSubscription: false }
  }

  let hasSubscription = false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = (await reg?.pushManager.getSubscription()) ?? null
    hasSubscription = Boolean(sub)
  } catch {
    hasSubscription = false
  }
  return { status: 'granted', hasSubscription }
}

/**
 * Detecta el estado del soporte de push en el navegador actual.
 *
 *  - `unsupported`: el navegador no tiene `Notification` o `serviceWorker`.
 *  - `ios_sin_pwa`: iOS Safari sin la web añadida a pantalla de inicio
 *    (Apple no permite push web fuera de PWA instalada).
 *  - `denied` | `default` | `granted`: estados estándar de
 *    `Notification.permission`.
 *
 * Además expone `hasSubscription`: si el usuario ya está suscrito (lo
 * comprueba interrogando al pushManager). Sirve para que la UI muestre el
 * botón correcto (activar vs desactivar).
 */
export function useNotificationPermission(): UseNotificationPermissionResult {
  const [state, setState] = useState<PermissionState>({ status: 'loading', hasSubscription: null })

  const refresh = useCallback(async () => {
    const next = await leerEstado()
    setState(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void leerEstado().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { ...state, refresh }
}
