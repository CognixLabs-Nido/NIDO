'use client'

import { MessageCircleIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { abrirConversacionAdminFamilia } from '../actions/abrir-conversacion-admin-familia'

interface Props {
  tutorId: string
  locale: string
}

/**
 * Botón "Conversación con dirección" usado en la ficha del niño (admin
 * abre/reabre el hilo con un tutor concreto). Al click invoca la action
 * `abrirConversacionAdminFamilia(tutorId)` y navega al hilo. Si ya existía
 * la action devuelve el mismo id y solo renueva el `expires_at`.
 */
export function AbrirConversacionDireccionButton({ tutorId, locale }: Props) {
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
      router.push(`/${locale}/messages/conversacion/${res.data.conversacion_id}`)
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
      data-testid={`abrir-conv-direccion-${tutorId}`}
    >
      <MessageCircleIcon className="size-4" />
      <span className="ml-1">{t('escribir_direccion')}</span>
    </Button>
  )
}
