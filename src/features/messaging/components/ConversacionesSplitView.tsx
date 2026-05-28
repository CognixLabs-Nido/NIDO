'use client'

import { ArrowLeftIcon, MessageCircleIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { marcarConversacionLeida } from '../actions/marcar-conversacion-leida'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import type { NinoMensajeriaItem } from '../queries/get-ninos-mensajeria'
import { PREFIX_ANULADO, type ConversacionHeader, type MensajeView } from '../types'

import { MarcarErroneoButton } from './MarcarErroneoButton'
import { MensajeComposer } from './MensajeComposer'

interface Props {
  locale: string
  /** Rol del usuario actual; controla cómo se renderiza el header del panel. */
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  ninos: NinoMensajeriaItem[]
  ninoSeleccionadoId: string | null
  /**
   * Si es false, no se renderiza la sidebar de niños (ni el buscador):
   * el panel ocupa el ancho completo. Caso de uso: tutor con un solo
   * hijo, donde el split-view es ruido visual sin valor.
   */
  mostrarLista: boolean
  detalleHeader: ConversacionHeader | null
  detalleMensajes: MensajeView[]
  participo: boolean
}

/**
 * Split-view tipo WhatsApp para `/messages` profe/tutor (Bug 3 post-F5):
 *  - Izquierda (1/3 desktop): lista de TODOS los niños sobre los que el
 *    usuario puede conversar, con el último mensaje y badge de no leídos.
 *    Para profe: niños de sus aulas activas. Para tutor: hijos vinculados
 *    con `puede_recibir_mensajes=true`.
 *  - Derecha (2/3 desktop): conversación del niño seleccionado. Si no hay
 *    conversación todavía, muestra empty state + composer en modo "iniciar"
 *    (crea la conversación al enviar el primer mensaje via server action).
 *
 * La selección se persiste en la URL (`?nino=<id>`) para deep-link y
 * recarga del SSR de los mensajes al cambiar de hilo. El padre Server
 * Component carga `detalleHeader` y `detalleMensajes` ya filtrados por
 * RLS según el `searchParams.nino`.
 *
 * Mobile (<768px): se muestra una vista a la vez. Si hay `ninoSeleccionado`
 * → conversación con botón "←" volver. Si no → lista.
 *
 * Realtime: el hook `useMessagingRealtime` refresca el server component
 * padre al recibir cualquier mensaje vía RLS. Marca como leída el hilo
 * seleccionado en el primer render y tras cada nuevo mensaje recibido.
 */
export function ConversacionesSplitView({
  locale,
  rol,
  ninos,
  ninoSeleccionadoId,
  mostrarLista,
  detalleHeader,
  detalleMensajes,
  participo,
}: Props) {
  const t = useTranslations('messages')
  const router = useRouter()
  const [filtro, setFiltro] = useState('')

  const filtrados = useMemo(() => {
    if (!filtro.trim()) return ninos
    const q = filtro.trim().toLowerCase()
    return ninos.filter((n) =>
      `${n.nombre} ${n.apellidos} ${n.aula_nombre ?? ''}`.toLowerCase().includes(q)
    )
  }, [filtro, ninos])

  const ninoSeleccionado = ninos.find((n) => n.nino_id === ninoSeleccionadoId) ?? null

  useMessagingRealtime({
    channel: `messages-split-${locale}`,
    onChange: () => {
      router.refresh()
    },
  })

  // Marcar como leída la conversación seleccionada al mostrarla y cuando
  // llegan mensajes nuevos. Tras el UPSERT exitoso forzamos `router.refresh()`
  // para que el SSR del layout recalcule `countNoLeidos()` y el
  // `MessagingBadge` se actualice — el realtime no escucha `lectura_*`.
  useEffect(() => {
    if (!detalleHeader?.id) return
    let cancelled = false
    void marcarConversacionLeida({ conversacion_id: detalleHeader.id }).then((res) => {
      if (cancelled) return
      if (res.success) router.refresh()
    })
    return () => {
      cancelled = true
    }
  }, [detalleHeader?.id, detalleMensajes.length, router])

  function selectNino(ninoId: string) {
    router.push(`/${locale}/messages?nino=${ninoId}`)
  }

  return (
    <div
      className={cn(
        'bg-card border-border/60 grid min-h-[calc(100dvh-12rem)] grid-cols-1 overflow-hidden rounded-2xl border',
        mostrarLista && 'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
      )}
    >
      {/* Sidebar lista (full-width mobile cuando ninguno seleccionado, oculta cuando hay selección).
          Si !mostrarLista (tutor con 1 hijo), no se renderiza nada — el panel ocupa todo el ancho. */}
      {mostrarLista && (
        <aside
          className={cn(
            'border-border/60 flex flex-col border-r',
            ninoSeleccionadoId ? 'hidden md:flex' : 'flex'
          )}
          aria-label={t('split.aside_label')}
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
              {ninos.length === 0 ? t('split.empty_lista') : t('split.empty_busqueda')}
            </p>
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto">
              {filtrados.map((n) => {
                const seleccionado = n.nino_id === ninoSeleccionadoId
                const initials = (n.nombre.charAt(0) + (n.apellidos.charAt(0) || '')).toUpperCase()
                return (
                  <li key={n.nino_id}>
                    <button
                      type="button"
                      onClick={() => selectNino(n.nino_id)}
                      aria-current={seleccionado ? 'true' : undefined}
                      className={cn(
                        'hover:bg-muted/40 flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
                        seleccionado && 'bg-muted/60'
                      )}
                      data-testid={`conv-list-item-${n.nino_id}`}
                    >
                      <div className="bg-primary-100 text-primary-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                        {initials || '?'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground truncate text-sm font-medium">
                            {n.nombre} {n.apellidos}
                          </span>
                          {n.last_message_at && (
                            <time
                              className="text-muted-foreground shrink-0 text-[10px]"
                              dateTime={n.last_message_at}
                            >
                              {formatRelative(n.last_message_at, locale)}
                            </time>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex items-center gap-2">
                          {n.aula_nombre && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {n.aula_nombre}
                            </Badge>
                          )}
                          <p
                            className={cn(
                              'min-w-0 flex-1 truncate text-xs',
                              !n.last_message_preview && 'italic'
                            )}
                          >
                            {n.last_message_preview ??
                              (n.last_message_at
                                ? t('lista.preview_anulado')
                                : t('split.sin_mensajes_preview'))}
                          </p>
                          {n.unread_count > 0 && (
                            <Badge
                              variant="default"
                              className="shrink-0 px-1.5 text-[10px]"
                              aria-label={t('lista.no_leidos', { n: n.unread_count })}
                            >
                              {n.unread_count > 9 ? '9+' : n.unread_count}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      )}

      {/* Panel derecho. Cuando mostrarLista=false (tutor con 1 hijo) este
          panel ocupa el ancho completo del grid. */}
      <section
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          // En modo lista: mobile oculta el panel si no hay selección.
          // En modo single (sin lista): siempre visible.
          mostrarLista && !ninoSeleccionadoId && 'hidden md:flex',
          !mostrarLista && 'flex'
        )}
        aria-label={t('split.panel_label')}
      >
        {ninoSeleccionado ? (
          <ConversacionPanel
            locale={locale}
            rol={rol}
            nino={ninoSeleccionado}
            header={detalleHeader}
            mensajes={detalleMensajes}
            participo={participo}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageCircleIcon className="size-10 opacity-50" />
            <p className="text-sm">{t('split.empty_panel')}</p>
          </div>
        )}
      </section>
    </div>
  )
}

interface PanelProps {
  locale: string
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  nino: NinoMensajeriaItem
  header: ConversacionHeader | null
  mensajes: MensajeView[]
  participo: boolean
}

function ConversacionPanel({ locale, rol, nino, header, mensajes, participo }: PanelProps) {
  const t = useTranslations('messages.conversacion')
  const tEstado = useTranslations('messages.estado')
  const tFicha = useTranslations('messages.ficha_nino')

  function labelForRol(r: MensajeView['autor_rol_label']): string {
    if (r === 'autor') return t('yo')
    if (r === 'admin') return t('rol_admin')
    if (r === 'profe') return t('rol_profe')
    return t('rol_tutor')
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <header className="bg-background flex items-center gap-3 border-b px-4 py-3">
        <Link
          href={`/${locale}/messages`}
          aria-label={t('volver')}
          className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md md:hidden"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <PanelTitulo rol={rol} nino={nino} header={header} t={t} />
        </div>
      </header>

      <ol role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 ? (
          <li className="text-muted-foreground py-12 text-center text-sm">
            {header ? t('sin_mensajes') : tFicha('empezar_conversacion')}
          </li>
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

      {participo && (
        <MensajeComposer ninoId={nino.nino_id} locale={locale} redirectOnFirstSend={!header} />
      )}
    </div>
  )
}

/**
 * Render del título del panel en función del rol del usuario.
 *
 * Replica la lógica de `HeaderTitulo` en `ConversacionView.tsx` (la vista
 * de pantalla completa de la conversación) — se mantienen separadas porque
 * el split-view siempre tiene un `nino` disponible incluso sin `header`
 * (caso "niño sin conversación todavía"), mientras que la vista de
 * pantalla completa exige `header` populated.
 *
 * Casos del lado tutor:
 *  - 1 profe activo: nombre del profe + subtítulo "Profe del aula X".
 *  - N>1 profes activos: "Profes del aula X" + subtítulo "N profes".
 *  - 0 profes (o sin conversación aún): "Aula X" si hay matrícula, en
 *    último caso el nombre del niño como fallback para no dejar el
 *    panel sin título.
 */
function PanelTitulo({
  rol,
  nino,
  header,
  t,
}: {
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  nino: NinoMensajeriaItem
  header: ConversacionHeader | null
  t: ReturnType<typeof useTranslations>
}) {
  const esTutor = rol === 'tutor_legal' || rol === 'autorizado'

  if (esTutor) {
    const aulaNombre = header?.aula_nombre ?? nino.aula_nombre
    const profes = header?.profes_aula ?? []
    if (profes.length === 1 && profes[0]) {
      return (
        <>
          <h2 className="truncate text-sm font-semibold">
            {t('title_tutor_profe', { nombre: profes[0].nombre_completo })}
          </h2>
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
          <h2 className="truncate text-sm font-semibold">
            {t('title_tutor_aula', { aula: aulaNombre })}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t('header_profes_count', { n: profes.length })}
          </p>
        </>
      )
    }
    if (aulaNombre) {
      return (
        <h2 className="truncate text-sm font-semibold">
          {t('title_tutor_aula_sin_profe', { aula: aulaNombre })}
        </h2>
      )
    }
    return (
      <h2 className="truncate text-sm font-semibold">
        {nino.nombre} {nino.apellidos}
      </h2>
    )
  }

  return (
    <>
      <h2 className="truncate text-sm font-semibold">
        {nino.nombre} {nino.apellidos}
      </h2>
      {nino.aula_nombre && (
        <p className="text-muted-foreground text-xs">
          {t('header_aula', { nombre: nino.aula_nombre })}
        </p>
      )}
    </>
  )
}

/**
 * "hace 5 min" / "ayer 14:00" / "lun 14:00" / "12/05" — formato corto
 * tipo WhatsApp para la columna derecha de la lista. Solo Intl.* nativo,
 * sin dependencias adicionales.
 */
function formatRelative(iso: string, locale: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24 && date.getDate() === now.getDate()) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(date)
}
