'use client'

import { BellIcon, BellOffIcon, SmartphoneIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { desuscribirPush } from '../actions/desuscribir-push'
import { activarPush } from '../lib/subscribe-flow'
import { useNotificationPermission, type PushStatus } from '../lib/use-notification-permission'

/**
 * Bloque de ajustes para activar/desactivar las push notifications.
 *
 * Pensado para insertarse dentro de un Card de `/profile`. Maneja todos los
 * estados (`unsupported`, `ios_sin_pwa`, `denied`, `default`, `granted`) y
 * delega los efectos secundarios (registro SW, suscripción, persistencia BD)
 * en server actions y APIs del navegador.
 *
 * No hace `requestPermission` en mount — solo cuando el usuario pulsa el
 * botón. Apple y Firefox bloquean los `requestPermission()` que no vengan
 * de un gesto del usuario.
 */
export function PushSettings(): React.ReactElement {
  const t = useTranslations('push.settings')
  const tErr = useTranslations('push.errors')
  const { status, hasSubscription, refresh } = useNotificationPermission()
  const [busy, setBusy] = useState<'idle' | 'activating' | 'deactivating'>('idle')

  async function activar(): Promise<void> {
    if (busy !== 'idle') return
    setBusy('activating')
    try {
      const res = await activarPush()
      if (res.ok) {
        toast.success(t('estado_activado'))
      } else {
        toast.error(tErr(res.errorKey))
      }
      await refresh()
    } finally {
      setBusy('idle')
    }
  }

  async function desactivar(): Promise<void> {
    if (busy !== 'idle') return
    setBusy('deactivating')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = (await reg?.pushManager.getSubscription()) ?? null
      if (!sub) {
        await refresh()
        return
      }
      const endpoint = sub.endpoint
      try {
        await sub.unsubscribe()
      } catch {
        // continuamos: aunque falle el unsubscribe del navegador, queremos
        // borrar la fila de BD para no seguir recibiendo intentos.
      }
      const result = await desuscribirPush({ endpoint })
      if (!result.success) {
        toast.error(tErr(result.error.replace('push.errors.', '') as 'suscripcion_fallo'))
      }
      await refresh()
    } catch (err) {
      console.error('[PushSettings] desactivar falló:', err)
      toast.error(tErr('suscripcion_fallo'))
    } finally {
      setBusy('idle')
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-3">
        <BellIcon className="text-primary-700 size-5" aria-hidden />
        <div className="space-y-0.5">
          <h2 className="text-foreground text-base font-semibold">{t('titulo')}</h2>
          <p className="text-muted-foreground text-xs">{t('descripcion')}</p>
        </div>
      </header>

      <PushStatusContent
        status={status}
        hasSubscription={hasSubscription}
        busy={busy}
        onActivar={activar}
        onDesactivar={desactivar}
      />
    </section>
  )
}

function PushStatusContent({
  status,
  hasSubscription,
  busy,
  onActivar,
  onDesactivar,
}: {
  status: PushStatus
  hasSubscription: boolean | null
  busy: 'idle' | 'activating' | 'deactivating'
  onActivar: () => Promise<void>
  onDesactivar: () => Promise<void>
}): React.ReactElement {
  const t = useTranslations('push.settings')

  if (status === 'loading') {
    return <p className="text-muted-foreground text-sm">…</p>
  }

  if (status === 'unsupported') {
    return (
      <p className="text-muted-foreground rounded-md bg-neutral-50 p-3 text-sm">
        {t('estado_unsupported')}
      </p>
    )
  }

  if (status === 'ios_sin_pwa') {
    return (
      <div className="bg-info-100 text-info-900 space-y-1 rounded-md p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <SmartphoneIcon className="size-4" aria-hidden />
          <span>{t('ios_titulo')}</span>
        </div>
        <p className="text-info-900/80 text-xs">{t('ios_anadir_a_pantalla')}</p>
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <p className="bg-accent-warm-100 text-accent-warm-900 rounded-md p-3 text-sm">
        {t('estado_denegado')}
      </p>
    )
  }

  if (status === 'granted' && hasSubscription) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-success-700 text-sm font-medium">{t('estado_activado')}</span>
        <Button
          type="button"
          variant="outline"
          onClick={() => void onDesactivar()}
          disabled={busy !== 'idle'}
        >
          <BellOffIcon className="size-4" aria-hidden />
          {busy === 'deactivating' ? t('desactivando') : t('desactivar')}
        </Button>
      </div>
    )
  }

  return (
    <Button type="button" onClick={() => void onActivar()} disabled={busy !== 'idle'}>
      <BellIcon className="size-4" aria-hidden />
      {busy === 'activating' ? t('activando') : t('activar')}
    </Button>
  )
}
