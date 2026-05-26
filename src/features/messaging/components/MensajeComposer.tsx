'use client'

import { SendHorizonalIcon } from 'lucide-react'
import { useTransition, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { enviarMensaje } from '../actions/enviar-mensaje'

interface Props {
  ninoId: string
  locale: string
  /**
   * Si la conversación ya existe, el composer no necesita navegar después de
   * enviar; el router.refresh() trae el mensaje nuevo. Si la conversación
   * NO existía aún (composer dentro de la ficha del niño en modo "iniciar"),
   * el action devuelve el id y navegamos al hilo.
   */
  redirectOnFirstSend?: boolean
}

const MAX = 2000

export function MensajeComposer({ ninoId, locale, redirectOnFirstSend }: Props) {
  const t = useTranslations('messages.conversacion')
  const tErr = useTranslations('messages.errors')
  const [contenido, setContenido] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const length = contenido.length
  const trimmed = contenido.trim()
  const disabled = pending || trimmed.length === 0 || trimmed.length > MAX

  function send() {
    if (disabled) return
    startTransition(async () => {
      const res = await enviarMensaje({ nino_id: ninoId, contenido: trimmed })
      if (!res.success) {
        toast.error(tErr(res.error.replace('messages.errors.', '') as 'envio_fallo'))
        return
      }
      setContenido('')
      if (redirectOnFirstSend && res.data.conversacion_id) {
        router.push(`/${locale}/messages/conversacion/${res.data.conversacion_id}`)
      } else {
        router.refresh()
      }
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="bg-background sticky bottom-0 -mx-4 border-t px-4 py-3 md:-mx-8 md:px-8">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Textarea
            value={contenido}
            onChange={(e) => setContenido(e.target.value.slice(0, MAX + 10))}
            onKeyDown={onKeyDown}
            placeholder={t('composer_placeholder')}
            rows={2}
            className="resize-none"
            disabled={pending}
            aria-label={t('composer_placeholder')}
          />
          <div className="text-muted-foreground mt-1 text-xs" aria-live="polite">
            {t('contador', { n: length, max: MAX })}
          </div>
        </div>
        <Button onClick={send} disabled={disabled} className="shrink-0">
          <SendHorizonalIcon className="size-4" />
          <span className="ml-1">{pending ? t('enviando') : t('enviar')}</span>
        </Button>
      </div>
    </div>
  )
}
