'use client'

import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { marcarConversacionLeida } from '../actions/marcar-conversacion-leida'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import { PREFIX_ANULADO, type ConversacionHeader, type MensajeView } from '../types'

import { MarcarErroneoButton } from './MarcarErroneoButton'
import { MensajeComposer } from './MensajeComposer'

interface Props {
  locale: string
  header: ConversacionHeader
  mensajes: MensajeView[]
  participo: boolean
}

/**
 * Vista del hilo de una conversación. Auto-marca como leída al montar
 * y cuando llega un mensaje vía Realtime estando la pestaña abierta.
 */
export function ConversacionView({ locale, header, mensajes, participo }: Props) {
  const t = useTranslations('messages.conversacion')
  const tRoles = useTranslations('messages.conversacion')
  const tEstado = useTranslations('messages.estado')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Marcar leída al montar (UPSERT idempotente).
  useEffect(() => {
    void marcarConversacionLeida({ conversacion_id: header.id })
  }, [header.id])

  // Realtime: cualquier mensaje nuevo en este hilo refresca + marca leído.
  useMessagingRealtime({
    channel: `messages-conv-${header.id}`,
    conversacionId: header.id,
    onChange: (table) => {
      if (table === 'mensajes') {
        void marcarConversacionLeida({ conversacion_id: header.id })
      }
    },
  })

  // Auto-scroll al fondo cuando cambian los mensajes.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes.length])

  function labelForRol(r: MensajeView['autor_rol_label']): string {
    if (r === 'autor') return tRoles('yo')
    if (r === 'admin') return tRoles('rol_admin')
    if (r === 'profe') return tRoles('rol_profe')
    return tRoles('rol_tutor')
  }

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <header className="bg-background sticky top-0 z-[1] -mx-4 border-b px-4 py-3 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/messages`}
            aria-label={t('volver')}
            className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {t('title', { nombre: header.nino_nombre })}
            </h1>
            {header.aula_nombre && (
              <p className="text-muted-foreground text-xs">
                {t('header_aula', { nombre: header.aula_nombre })}
              </p>
            )}
          </div>
        </div>
      </header>

      <ol role="log" aria-live="polite" className="flex-1 space-y-3 py-4">
        {mensajes.length === 0 ? (
          <li className="text-muted-foreground py-12 text-center text-sm">{t('sin_mensajes')}</li>
        ) : (
          mensajes.map((m) => {
            const contenidoVisible = m.erroneo
              ? m.contenido.replace(PREFIX_ANULADO, '')
              : m.contenido
            const alignRight = m.es_propio
            return (
              <li key={m.id} className={cn('flex', alignRight ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[80%] space-y-1', alignRight && 'text-right')}>
                  <div
                    className={cn(
                      'flex items-center gap-2 text-xs',
                      alignRight ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <span className="text-muted-foreground font-medium">
                      {labelForRol(m.autor_rol_label)}
                      {m.autor_rol_label !== 'autor' && (
                        <span className="ml-1 font-normal opacity-70">· {m.autor_nombre}</span>
                      )}
                    </span>
                    <time className="text-muted-foreground" dateTime={m.created_at}>
                      {new Intl.DateTimeFormat(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(m.created_at))}
                    </time>
                  </div>
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-2 text-sm',
                      alignRight
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                      m.erroneo && 'line-through opacity-60'
                    )}
                  >
                    {m.erroneo && (
                      <Badge
                        variant="outline"
                        className="mr-2 text-[10px]"
                        aria-label={tEstado('anulado')}
                      >
                        {tEstado('anulado')}
                      </Badge>
                    )}
                    <span className="break-words whitespace-pre-wrap">{contenidoVisible}</span>
                  </div>
                  {m.es_propio && !m.erroneo && (
                    <div className="flex justify-end pt-0.5">
                      <MarcarErroneoButton target="mensaje" id={m.id} inline />
                    </div>
                  )}
                </div>
              </li>
            )
          })
        )}
        <div ref={scrollRef} />
      </ol>

      {participo && <MensajeComposer ninoId={header.nino_id} locale={locale} />}
    </div>
  )
}
