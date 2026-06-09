'use client'

import { ArrowLeftIcon, EyeIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import { useScrollAlFondo } from '../lib/use-scroll-al-fondo'
import {
  PREFIX_ANULADO,
  type ConversacionHeader,
  type ConversacionListItem,
  type MensajeView,
} from '../types'

import { IrAlFondoButton } from './IrAlFondoButton'

interface Props {
  locale: string
  /** Todas las conversaciones profe↔familia del centro (RLS de admin). */
  conversaciones: ConversacionListItem[]
  /** `?conv=<id>` resuelto en SSR; `null` si no hay selección o id inválido. */
  convSeleccionadaId: string | null
  detalleHeader: ConversacionHeader | null
  detalleMensajes: MensajeView[]
}

/**
 * Tab "Dirección" (solo admin): **supervisión en SOLO LECTURA** de todas las
 * conversaciones profe↔familia del centro. La directora VE el historial pero
 * NO interviene — sin composer ni acciones. Selección por `?conv=<id>`.
 *
 * No marca las conversaciones como leídas (no genera read-receipts de admin)
 * ni cuenta no-leídos: es observación, no bandeja de entrada.
 */
export function AdminSupervisionSplitView({
  locale,
  conversaciones,
  convSeleccionadaId,
  detalleHeader,
  detalleMensajes,
}: Props) {
  const t = useTranslations('messages')
  const tSup = useTranslations('messages.supervision')
  const router = useRouter()
  const [filtro, setFiltro] = useState('')

  const filtrados = useMemo(() => {
    if (!filtro.trim()) return conversaciones
    const q = filtro.trim().toLowerCase()
    return conversaciones.filter((c) =>
      `${c.nino_nombre} ${c.nino_apellidos} ${c.aula_nombre ?? ''}`.toLowerCase().includes(q)
    )
  }, [filtro, conversaciones])

  const seleccionada = conversaciones.find((c) => c.id === convSeleccionadaId) ?? null

  // Realtime: refresca el SSR si llega un mensaje nuevo en cualquier hilo que
  // el admin pueda leer (RLS), para que la supervisión se mantenga al día.
  const onRealtimeChange = useCallback(() => {
    router.refresh()
  }, [router])
  useMessagingRealtime({
    channel: `messages-supervision-${locale}`,
    onChange: onRealtimeChange,
  })

  function selectConv(convId: string) {
    router.push(`/${locale}/messages?tab=supervision&conv=${convId}`)
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <ShieldCheckIcon className="size-4 shrink-0" />
        {tSup('descripcion')}
      </p>

      <div
        className={cn(
          'bg-card border-border/60 grid h-[calc(100dvh-20rem)] grid-cols-1 grid-rows-1 overflow-hidden rounded-2xl border md:h-[calc(100dvh-14rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
        )}
      >
        {/* Lista de conversaciones (full-width mobile sin selección). */}
        <aside
          className={cn(
            'border-border/60 flex flex-col border-r',
            convSeleccionadaId ? 'hidden md:flex' : 'flex'
          )}
          aria-label={tSup('aside_label')}
        >
          <div className="border-border/60 border-b p-3">
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2 size-4" />
              <Input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder={t('split.buscar_placeholder')}
                className="pl-8"
                aria-label={t('split.buscar_placeholder')}
              />
            </div>
          </div>
          {filtrados.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              {conversaciones.length === 0 ? tSup('empty_lista') : t('split.empty_busqueda')}
            </p>
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto">
              {filtrados.map((c) => {
                const seleccionado = c.id === convSeleccionadaId
                const initials = (
                  c.nino_nombre.charAt(0) + (c.nino_apellidos.charAt(0) || '')
                ).toUpperCase()
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectConv(c.id)}
                      aria-current={seleccionado ? 'true' : undefined}
                      className={cn(
                        'hover:bg-muted/40 flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
                        seleccionado && 'bg-muted/60'
                      )}
                      data-testid={`supervision-list-item-${c.id}`}
                    >
                      <div className="bg-primary-100 text-primary-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                        {initials || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {c.nino_nombre} {c.nino_apellidos}
                          </span>
                          {c.last_message_at && (
                            <time
                              className="text-muted-foreground shrink-0 text-[10px]"
                              dateTime={c.last_message_at}
                            >
                              {new Intl.DateTimeFormat(locale, {
                                day: '2-digit',
                                month: '2-digit',
                              }).format(new Date(c.last_message_at))}
                            </time>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2">
                          {c.aula_nombre && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {c.aula_nombre}
                            </Badge>
                          )}
                          <p
                            className={cn(
                              'min-w-0 flex-1 truncate text-xs',
                              !c.last_message_preview && 'italic'
                            )}
                          >
                            {c.last_message_preview ??
                              (c.last_message_at
                                ? t('lista.preview_anulado')
                                : t('split.sin_mensajes_preview'))}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Panel derecho: historial en solo lectura. */}
        <section
          className={cn('flex min-w-0 flex-1 flex-col', !convSeleccionadaId && 'hidden md:flex')}
          aria-label={tSup('panel_label')}
        >
          {seleccionada ? (
            <SupervisionPanel
              locale={locale}
              header={detalleHeader}
              mensajes={detalleMensajes}
              fallbackNombre={`${seleccionada.nino_nombre} ${seleccionada.nino_apellidos}`}
              fallbackAula={seleccionada.aula_nombre}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <EyeIcon className="size-10 opacity-50" />
              <p className="text-sm">{tSup('empty_panel')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

interface PanelProps {
  locale: string
  header: ConversacionHeader | null
  mensajes: MensajeView[]
  fallbackNombre: string
  fallbackAula: string | null
}

function SupervisionPanel({ locale, header, mensajes, fallbackNombre, fallbackAula }: PanelProps) {
  const t = useTranslations('messages.conversacion')
  const tEstado = useTranslations('messages.estado')
  const tSup = useTranslations('messages.supervision')
  const { containerRef, mostrarBotonIrAlFondo, irAlFondo } = useScrollAlFondo(mensajes.length)

  const nombre = header ? `${header.nino_nombre} ${header.nino_apellidos}` : fallbackNombre
  const aula = header?.aula_nombre ?? fallbackAula

  function labelForRol(r: MensajeView['autor_rol_label']): string {
    if (r === 'admin') return t('rol_admin')
    if (r === 'profe') return t('rol_profe')
    return t('rol_tutor')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="bg-background flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Link
          href={`/${locale}/messages?tab=supervision`}
          aria-label={t('volver')}
          className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md md:hidden"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{nombre}</h2>
          {aula && (
            <p className="text-muted-foreground text-xs">{t('header_aula', { nombre: aula })}</p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
          <EyeIcon className="size-3" />
          {tSup('solo_lectura')}
        </Badge>
      </header>

      <div ref={containerRef} className="relative flex-1 overflow-y-auto">
        <ol role="log" className="space-y-3 px-4 py-4">
          {mensajes.length === 0 ? (
            <li className="text-muted-foreground py-12 text-center text-sm">{t('sin_mensajes')}</li>
          ) : (
            mensajes.map((m) => {
              const contenidoVisible = m.erroneo
                ? m.contenido.replace(PREFIX_ANULADO, '')
                : m.contenido
              // Alineación tipo chat de dos partes: tutor a la derecha, profe a
              // la izquierda. Ninguno es "propio" (el admin solo observa).
              const alignRight = m.autor_rol_label === 'tutor'
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
                        <span className="ml-1 font-normal opacity-70">· {m.autor_nombre}</span>
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
                        alignRight ? 'bg-primary-100 text-foreground' : 'bg-muted text-foreground',
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
                  </div>
                </li>
              )
            })
          )}
        </ol>
        {mostrarBotonIrAlFondo && (
          <IrAlFondoButton onClick={irAlFondo} testId="ir-al-fondo-supervision" />
        )}
      </div>
    </div>
  )
}
