'use client'

import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { marcarConversacionLeida } from '../actions/marcar-conversacion-leida'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import { useScrollAlFondo } from '../lib/use-scroll-al-fondo'
import { PREFIX_ANULADO, type ConversacionHeader, type MensajeView } from '../types'

import { IrAlFondoButton } from './IrAlFondoButton'
import { MarcarErroneoButton } from './MarcarErroneoButton'
import { MensajeComposer } from './MensajeComposer'

interface Props {
  locale: string
  /** Rol del usuario actual en el centro. Determina cómo se renderiza
   *  el header: tutor → nombre del/los profe(s); profe/admin → nombre del niño. */
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  header: ConversacionHeader
  mensajes: MensajeView[]
  participo: boolean
}

/**
 * Vista del hilo de una conversación. Auto-marca como leída al montar
 * y cuando llega un mensaje vía Realtime estando la pestaña abierta.
 */
export function ConversacionView({ locale, rol, header, mensajes, participo }: Props) {
  const t = useTranslations('messages.conversacion')
  const tRoles = useTranslations('messages.conversacion')
  const tEstado = useTranslations('messages.estado')
  const router = useRouter()
  const { containerRef, mostrarBotonIrAlFondo, irAlFondo } = useScrollAlFondo(mensajes.length)

  // Marcar leída al montar (UPSERT idempotente). Tras el éxito forzamos
  // `router.refresh()` para que el SSR del layout recalcule el badge
  // global — el realtime no escucha `lectura_conversacion`.
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

  // Realtime: cualquier mensaje nuevo en este hilo refresca + marca leído.
  // Mismo refresh tras la lectura para que el badge baje en vivo si el
  // usuario está mirando este hilo cuando llega el mensaje.
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

  function labelForRol(r: MensajeView['autor_rol_label']): string {
    if (r === 'autor') return tRoles('yo')
    if (r === 'admin') return tRoles('rol_admin')
    if (r === 'profe') return tRoles('rol_profe')
    return tRoles('rol_tutor')
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <header className="bg-background z-[1] -mx-4 shrink-0 border-b px-4 py-3 md:-mx-8 md:px-8">
        <div className="flex items-center gap-3">
          <Link
            href={`/${locale}/messages`}
            aria-label={t('volver')}
            className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <HeaderTitulo rol={rol} header={header} t={t} />
          </div>
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative -mx-4 flex-1 overflow-y-auto px-4 md:-mx-8 md:px-8"
        data-testid="conv-scroll-container"
      >
        <ol role="log" aria-live="polite" className="space-y-3 py-4">
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
        </ol>
        {mostrarBotonIrAlFondo && <IrAlFondoButton onClick={irAlFondo} />}
      </div>

      {participo && <MensajeComposer ninoId={header.nino_id} locale={locale} />}
    </div>
  )
}

/**
 * Render del título del header en función del rol del usuario.
 *
 * - Profe / admin: nombre del niño + aula (la conversación es "el hilo del
 *   niño X" desde el lado del personal del centro).
 * - Tutor / autorizado: nombre del/los profe(s) del aula del niño, NO el
 *   nombre del propio hijo (decisión UX post-F5: el tutor sabe a quién
 *   está escribiendo, no necesita el nombre del niño en cada hilo).
 *
 * Casos del lado tutor:
 *  - 1 profe activo: nombre del profe + subtítulo "Profe del aula X".
 *  - N>1 profes activos: "Profes del aula X" + subtítulo "N profes".
 *  - 0 profes activos: "Aula X" como fallback. Si tampoco hay aula
 *    (matrícula histórica eliminada, edge case), cae al nombre del niño.
 */
function HeaderTitulo({
  rol,
  header,
  t,
}: {
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  header: ConversacionHeader
  t: ReturnType<typeof useTranslations>
}) {
  const esTutor = rol === 'tutor_legal' || rol === 'autorizado'

  if (esTutor) {
    const aulaNombre = header.aula_nombre
    const profes = header.profes_aula
    if (profes.length === 1 && profes[0]) {
      return (
        <>
          <h1 className="truncate text-base font-semibold">
            {t('title_tutor_profe', { nombre: profes[0].nombre_completo })}
          </h1>
          {aulaNombre && (
            <p className="text-muted-foreground text-xs">
              {t('header_profe_subtitulo', { aula: aulaNombre })}
            </p>
          )}
        </>
      )
    }
    if (profes.length > 1 && aulaNombre) {
      return (
        <>
          <h1 className="truncate text-base font-semibold">
            {t('title_tutor_aula', { aula: aulaNombre })}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t('header_profes_count', { n: profes.length })}
          </p>
        </>
      )
    }
    if (aulaNombre) {
      return (
        <h1 className="truncate text-base font-semibold">
          {t('title_tutor_aula_sin_profe', { aula: aulaNombre })}
        </h1>
      )
    }
    // Edge: ni profes ni aula — fallback al nombre del niño para no
    // mostrar un header vacío.
    return <h1 className="truncate text-base font-semibold">{header.nino_nombre}</h1>
  }

  // Vista profe / admin: nombre del niño + aula (comportamiento original).
  return (
    <>
      <h1 className="truncate text-base font-semibold">
        {t('title', { nombre: header.nino_nombre })}
      </h1>
      {header.aula_nombre && (
        <p className="text-muted-foreground text-xs">
          {t('header_aula', { nombre: header.aula_nombre })}
        </p>
      )}
    </>
  )
}
