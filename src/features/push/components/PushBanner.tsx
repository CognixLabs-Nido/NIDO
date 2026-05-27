'use client'

import { BellIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSyncExternalStore, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { useNotificationPermission } from '../lib/use-notification-permission'
import { activarPush } from '../lib/subscribe-flow'

const DISMISS_KEY = 'nido:push-banner-dismissed'

/** Listeners locales que disparamos al hacer dismiss; el `storage` event
 *  nativo no se emite en la misma pestaña, así que necesitamos un canal
 *  in-tab para que `useSyncExternalStore` re-evalúe `getSnapshot`. */
const dismissListeners = new Set<() => void>()

function subscribeDismiss(cb: () => void): () => void {
  dismissListeners.add(cb)
  return () => {
    dismissListeners.delete(cb)
  }
}

function notifyDismissChanged(): void {
  for (const cb of dismissListeners) cb()
}

function getDismissedSnapshot(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function getDismissedServerSnapshot(): boolean {
  return true // En SSR no mostramos el banner para evitar hidration flicker.
}

/**
 * Banner contextual en `/messages` que invita a activar las notificaciones
 * push cuando el usuario aún no ha decidido.
 *
 * Reglas:
 *  - Solo se muestra si `status === 'default'` (el navegador no ha pedido
 *    permiso aún) y existe soporte de push. Los estados `unsupported`,
 *    `denied`, `granted` y `ios_sin_pwa` lo ocultan.
 *  - El componente solo se renderiza para tutores y profes — el caller
 *    decide montarlo o no. Admin no lo ve.
 *  - Una vez descartado con "Ahora no", queda oculto durante la sesión del
 *    navegador (`sessionStorage`). Al cerrar y reabrir el navegador
 *    reaparece, porque el usuario podría haber cambiado de idea.
 *  - Si activa con éxito, el banner desaparece automáticamente (el hook
 *    `useNotificationPermission` recalcula `status` y la condición ya no
 *    se cumple).
 */
export function PushBanner(): React.ReactElement | null {
  const t = useTranslations('push.banner')
  const tErr = useTranslations('push.errors')
  const tSettings = useTranslations('push.settings')
  const { status, refresh } = useNotificationPermission()
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    getDismissedSnapshot,
    getDismissedServerSnapshot
  )
  const [busy, setBusy] = useState(false)

  if (status !== 'default' || dismissed) {
    return null
  }

  async function onActivar(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await activarPush()
      if (res.ok) {
        toast.success(tSettings('estado_activado'))
        await refresh()
      } else {
        toast.error(tErr(res.errorKey))
      }
    } finally {
      setBusy(false)
    }
  }

  function onDescartar(): void {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // sessionStorage indisponible — aceptamos perder la preferencia.
    }
    notifyDismissChanged()
  }

  return (
    <div
      role="region"
      aria-label={t('titulo')}
      className="bg-primary-50 border-primary-200 flex flex-wrap items-start gap-3 rounded-lg border p-3"
    >
      <div className="bg-primary-100 text-primary-700 flex size-9 shrink-0 items-center justify-center rounded-full">
        <BellIcon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground text-sm font-semibold">{t('titulo')}</p>
        <p className="text-muted-foreground text-xs">{t('descripcion')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={() => void onActivar()} disabled={busy}>
          {t('cta_activar')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDescartar}
          aria-label={t('descartar_aria')}
        >
          <XIcon className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t('cta_descartar')}</span>
        </Button>
      </div>
    </div>
  )
}
