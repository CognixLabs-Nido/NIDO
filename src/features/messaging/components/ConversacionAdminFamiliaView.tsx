'use client'

import { ArrowLeftIcon, ShieldCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { marcarConversacionLeida } from '../actions/marcar-conversacion-leida'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import { PREFIX_ANULADO, type ConversacionAdminFamiliaHeader, type MensajeView } from '../types'

import { MarcarErroneoButton } from './MarcarErroneoButton'
import { MensajeComposer } from './MensajeComposer'
import { ReabrirConversacionButton } from './ReabrirConversacionButton'

interface Props {
  locale: string
  /** Rol del caller dentro del hilo, NO el rol global. */
  rolEnHilo: 'admin' | 'tutor'
  header: ConversacionAdminFamiliaHeader
  mensajes: MensajeView[]
}

/**
 * Vista del hilo admin ↔ familia (F5.6-A). Equivalente a `ConversacionView`
 * (profe_familia) pero adaptada al modelo per-par:
 *
 *  - Header: badge "Dirección" + nombre del OTRO miembro del par (admin
 *    ve nombre del tutor; tutor ve nombre del admin). Indicador estático
 *    "Se cierra el {fecha}" o "Cerrada el {fecha}".
 *  - Composer: deshabilitado si `expires_at <= now()`. La lógica vive en
 *    `MensajeComposer` modo `admin_familia`.
 *  - Reabrir: solo cuando `rolEnHilo === 'admin'` Y caducada. Reabrir es
 *    UPSERT del `expires_at` (no envía mensaje).
 *
 * Marca como leída al montar y tras cada mensaje entrante por Realtime,
 * idéntico al patrón de `ConversacionView`.
 */
export function ConversacionAdminFamiliaView({ locale, rolEnHilo, header, mensajes }: Props) {
  const t = useTranslations('messages.conversacion')
  const tAdmin = useTranslations('messages.admin_familia')
  const tBadge = useTranslations('messages.badge')
  const tEstado = useTranslations('messages.estado')
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Snapshot de `Date.now()` al montar (regla `react-hooks/purity` prohíbe
  // llamadas impuras durante render). Spec: sin countdown, refresh basta.
  const [nowMs] = useState(() => Date.now())
  const expiresAtMs = Date.parse(header.expires_at)
  const caducada = expiresAtMs <= nowMs
  const contrapartNombre = rolEnHilo === 'admin' ? header.tutor_nombre : header.admin_nombre

  // Marcar leída al montar.
  useEffect(() => {
    let cancelled = false
    void marcarConversacionLeida({ conversacion_id: header.id }).then((res) => {
      if (cancelled) return
      if (res.success) router.refresh()
    })
    return () => {
      cancelled = true
    }
  }, [header.id, router])

  // Realtime: mensaje nuevo en este hilo → refresh + marcar leído.
  useMessagingRealtime({
    channel: `messages-conv-${header.id}`,
    conversacionId: header.id,
    onChange: (table) => {
      if (table === 'mensajes') {
        void marcarConversacionLeida({ conversacion_id: header.id }).then((res) => {
          if (res.success) router.refresh()
        })
      }
    },
  })

  // Auto-scroll al fondo cuando cambian los mensajes (mismo patrón F5).
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensajes.length])

  function labelForRol(r: MensajeView['autor_rol_label']): string {
    if (r === 'autor') return t('yo')
    if (r === 'admin') return t('rol_admin')
    return t('rol_tutor')
  }

  const fechaCorta = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(header.expires_at))

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col" data-testid="conv-admin-familia">
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
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1" data-testid="badge-direccion">
                <ShieldCheckIcon className="size-3" />
                {tBadge('direccion')}
              </Badge>
              <h1 className="truncate text-base font-semibold">{contrapartNombre}</h1>
            </div>
            <p
              className={cn('text-xs', caducada ? 'text-warning-700' : 'text-muted-foreground')}
              data-testid="indicador-caducidad"
            >
              {caducada
                ? tAdmin('indicador_cerrada', { fecha: fechaCorta })
                : tAdmin('indicador_activo', { fecha: fechaCorta })}
            </p>
          </div>
          {rolEnHilo === 'admin' && caducada && (
            <ReabrirConversacionButton tutorId={header.tutor_id} />
          )}
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
                      <MarcarErroneoButton
                        target="mensaje"
                        id={m.id}
                        createdAt={m.created_at}
                        inline
                      />
                    </div>
                  )}
                </div>
              </li>
            )
          })
        )}
        <div ref={scrollRef} />
      </ol>

      <MensajeComposer
        mode="admin_familia"
        conversacionId={header.id}
        expiresAt={header.expires_at}
        locale={locale}
      />
    </div>
  )
}
