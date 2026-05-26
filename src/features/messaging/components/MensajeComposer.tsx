'use client'

import { SendHorizonalIcon } from 'lucide-react'
import { useTransition, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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

/**
 * Composer de mensaje. Usa un <button> HTML nativo (no el <Button> de
 * shadcn) porque el primitive `@base-ui/react/button` fuerza
 * `type="button"` con prioridad sobre cualquier `type` que le pase el
 * caller: `useRenderElement` mergea `[elementProps, getButtonProps]`
 * con `getButtonProps()` como rightmost, y `mergePropsN` resuelve
 * conflictos a favor del último. Resultado: pasar `type="submit"` al
 * <Button> NO funciona — el DOM final es `<button type="button">` y
 * el submit del form nunca se dispara (Console/Network vacíos en
 * DevTools, regresión real reportada tras el PR #18).
 *
 * Aplicamos las clases de `buttonVariants()` directamente al <button>
 * nativo para mantener el aspecto visual.
 */
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
      try {
        const res = await enviarMensaje({ nino_id: ninoId, contenido: trimmed })
        if (!res.success) {
          const key = res.error.startsWith('messages.errors.')
            ? (res.error.slice('messages.errors.'.length) as 'envio_fallo')
            : ('envio_fallo' as const)
          toast.error(tErr(key))
          return
        }
        setContenido('')
        if (redirectOnFirstSend && res.data.conversacion_id) {
          router.push(`/${locale}/messages/conversacion/${res.data.conversacion_id}`)
        } else {
          router.refresh()
        }
      } catch {
        toast.error(tErr('envio_fallo'))
      }
    })
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    send()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-background sticky bottom-0 -mx-4 border-t px-4 py-3 md:-mx-8 md:px-8"
      data-testid="mensaje-composer-form"
    >
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
            name="contenido"
          />
          <div className="text-muted-foreground mt-1 text-xs" aria-live="polite">
            {t('contador', { n: length, max: MAX })}
          </div>
        </div>
        <button
          type="submit"
          disabled={disabled}
          className={cn(buttonVariants({ variant: 'default' }), 'shrink-0')}
          data-testid="mensaje-composer-submit"
        >
          <SendHorizonalIcon className="size-4" />
          <span className="ml-1">{pending ? t('enviando') : t('enviar')}</span>
        </button>
      </div>
    </form>
  )
}
