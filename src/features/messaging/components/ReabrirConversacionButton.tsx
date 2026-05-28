'use client'

import { RefreshCwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { abrirConversacionAdminFamilia } from '../actions/abrir-conversacion-admin-familia'

interface Props {
  tutorId: string
}

/**
 * Botón "Reabrir conversación" (lado admin, hilo caducado). Invoca el
 * mismo `abrirConversacionAdminFamilia` que la apertura inicial — la
 * action hace UPSERT y solo actualiza `expires_at`. No envía mensaje.
 *
 * Tras éxito hace `router.refresh()` para que el SSR del hilo recalcule
 * `expires_at` y el composer vuelva a habilitarse.
 */
export function ReabrirConversacionButton({ tutorId }: Props) {
  const t = useTranslations('messages.admin_familia')
  const tErr = useTranslations('messages.errors')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onClick() {
    startTransition(async () => {
      const res = await abrirConversacionAdminFamilia(tutorId)
      if (!res.success) {
        const key = res.error.startsWith('messages.errors.')
          ? (res.error.slice('messages.errors.'.length) as 'apertura_fallo')
          : ('apertura_fallo' as const)
        toast.error(tErr(key))
        return
      }
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant="default"
      onClick={onClick}
      disabled={pending}
      data-testid="reabrir-conversacion"
    >
      <RefreshCwIcon className="size-4" />
      <span className="ml-1">{pending ? t('reabriendo') : t('reabrir')}</span>
    </Button>
  )
}
