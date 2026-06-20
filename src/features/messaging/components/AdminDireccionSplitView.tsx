'use client'

import { MessageCircleIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { marcarConversacionLeida } from '../actions/marcar-conversacion-leida'
import { MESSAGES_TAB } from '../lib/messages-tabs'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import type { ConversacionAdminFamiliaHeader, MensajeView, TutorDireccionItem } from '../types'

import { ConversacionAdminFamiliaView } from './ConversacionAdminFamiliaView'
import { MensajeComposer } from './MensajeComposer'

interface Props {
  locale: string
  tutores: TutorDireccionItem[]
  tutorSeleccionadoId: string | null
  /** Si el tutor seleccionado YA tiene hilo, el padre Server Component
   *  carga el header + mensajes y los pasa aquí. Si NO tiene hilo (modo
   *  iniciar), ambos son null y el panel renderiza el composer con
   *  `mode='admin_familia_iniciar'`. */
  detalleHeader: ConversacionAdminFamiliaHeader | null
  detalleMensajes: MensajeView[]
}

/**
 * F5B-Items1+2 — Split-view tipo WhatsApp para el tab "Dirección" del
 * admin en `/messages`. Paralelo a `ConversacionesSplitView` (profe/tutor
 * niño-céntrico) pero adaptado al modelo per-par admin↔familia:
 *
 *  - Izquierda (1/3 desktop): lista de TODOS los tutores del centro
 *    (vínculo activo sobre algún niño). Dedup por usuario_id. Buscador
 *    client-side por nombre del tutor y nombres de hijos.
 *  - Derecha (2/3 desktop): conversación del tutor seleccionado. Si no
 *    hay hilo todavía, muestra empty state + composer en modo "iniciar"
 *    (crea conv + envía mensaje en 2 actions secuenciales).
 *
 * Mobile (<md): lista fullscreen → click → panel fullscreen → "←" volver.
 * La selección se persiste en `?tutor=<usuario_id>` para deep-link.
 *
 * Realtime: `useMessagingRealtime` (global, sin filtro de conv) refresca
 * el server component padre al recibir un mensaje en cualquier hilo —
 * la lista actualiza last_message_at y unread_count en vivo.
 *
 * Aplicaciones del aprendizaje del PR #31:
 *  - `h-[calc(100dvh-18rem)] md:h-[calc(100dvh-12rem)]` y `grid-rows-1`
 *    para que el row propague altura a la celda.
 *  - `ConversacionAdminFamiliaView` se monta con `fillParent={true}` para
 *    que use `h-full` en lugar de su `h-[calc(100dvh-3rem)]` por defecto.
 */
export function AdminDireccionSplitView({
  locale,
  tutores,
  tutorSeleccionadoId,
  detalleHeader,
  detalleMensajes,
}: Props) {
  const t = useTranslations('messages.admin_direccion')
  const tBadge = useTranslations('messages.badge')
  const router = useRouter()
  const [filtro, setFiltro] = useState('')

  // Tutor seleccionado: si el `?tutor=<id>` apunta a alguien que no está
  // en la lista (admin perdió permiso, vínculo borrado entre navegaciones,
  // etc.), ignoramos gracefully (Nota C del checkpoint B): no rompemos
  // la página ni mostramos error — render sin selección.
  const tutorSeleccionado = useMemo(
    () => tutores.find((tt) => tt.usuario_id === tutorSeleccionadoId) ?? null,
    [tutores, tutorSeleccionadoId]
  )

  // Filtro client-side por nombre + hijos. Normaliza acentos para que
  // "lucia" matchee "Lucía" y tokeniza por espacios para "mar lu" → cada
  // token debe aparecer en algún campo.
  const filtrados = useMemo(() => {
    const q = norm(filtro).trim()
    if (!q) return tutores
    const tokens = q.split(/\s+/).filter(Boolean)
    return tutores.filter((tt) => {
      const haystack = norm(
        `${tt.nombre_completo} ${tt.hijos.map((h) => `${h.nombre} ${h.apellidos}`).join(' ')}`
      )
      return tokens.every((tok) => haystack.includes(tok))
    })
  }, [filtro, tutores])

  const onRealtimeChange = useCallback(() => {
    router.refresh()
  }, [router])
  useMessagingRealtime({
    channel: `messages-admin-direccion-${locale}`,
    onChange: onRealtimeChange,
  })

  // Marcar leído al mostrar un hilo + cuando llegan mensajes nuevos.
  // El UPSERT en lectura_conversacion es idempotente.
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

  function selectTutor(tutorId: string) {
    router.push(`/${locale}/messages?tab=${MESSAGES_TAB.mensajeria}&tutor=${tutorId}`)
  }

  return (
    <div
      className={cn(
        'bg-card border-border/60 grid h-[calc(100dvh-18rem)] grid-cols-1 grid-rows-1 overflow-hidden rounded-2xl border md:h-[calc(100dvh-12rem)]',
        'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
      )}
    >
      <aside
        className={cn(
          'border-border/60 flex flex-col border-r',
          tutorSeleccionadoId ? 'hidden md:flex' : 'flex'
        )}
        aria-label={t('aside_label')}
      >
        <div className="border-border/60 border-b p-3">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2.5 left-2 size-4" />
            <Input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder={t('buscar_placeholder')}
              className="pl-8"
              aria-label={t('buscar_placeholder')}
            />
          </div>
        </div>
        {filtrados.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            {tutores.length === 0 ? t('empty_lista') : t('empty_busqueda')}
          </p>
        ) : (
          <ul className="flex-1 divide-y overflow-y-auto">
            {filtrados.map((tt) => {
              const seleccionado = tt.usuario_id === tutorSeleccionadoId
              const initials = iniciales(tt.nombre_completo)
              const hijosLabel = tt.hijos.map((h) => `${h.nombre} ${h.apellidos}`).join(', ')
              return (
                <li key={tt.usuario_id}>
                  <button
                    type="button"
                    onClick={() => selectTutor(tt.usuario_id)}
                    aria-current={seleccionado ? 'true' : undefined}
                    className={cn(
                      'hover:bg-muted/40 flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
                      seleccionado && 'bg-muted/60'
                    )}
                    data-testid={`tutor-list-item-${tt.usuario_id}`}
                  >
                    <div className="bg-primary-100 text-primary-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                      {initials || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground truncate text-sm font-medium">
                          {tt.nombre_completo}
                        </span>
                        {tt.last_message_at && (
                          <time
                            className="text-muted-foreground shrink-0 text-[10px]"
                            dateTime={tt.last_message_at}
                          >
                            {formatRelative(tt.last_message_at, locale)}
                          </time>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-2">
                        {hijosLabel && (
                          <span className="min-w-0 flex-1 truncate text-xs">
                            <span className="mr-1 font-medium">
                              {tt.hijos.length === 1
                                ? t('hijos_label_uno')
                                : t('hijos_label_varios')}
                            </span>
                            {hijosLabel}
                          </span>
                        )}
                        {tt.unread_count > 0 && (
                          <Badge
                            variant="default"
                            className="shrink-0 px-1.5 text-[10px]"
                            aria-label={`${tt.unread_count}`}
                          >
                            {tt.unread_count > 9 ? '9+' : tt.unread_count}
                          </Badge>
                        )}
                      </div>
                      {tt.last_message_preview && (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {tt.last_message_preview}
                        </p>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>

      <section
        className={cn('flex min-w-0 flex-1 flex-col', !tutorSeleccionadoId && 'hidden md:flex')}
        aria-label={t('panel_label')}
      >
        {tutorSeleccionado ? (
          detalleHeader ? (
            <ConversacionAdminFamiliaView
              locale={locale}
              rolEnHilo="admin"
              header={detalleHeader}
              mensajes={detalleMensajes}
              fillParent
            />
          ) : (
            <PanelIniciar locale={locale} tutor={tutorSeleccionado} tBadge={tBadge('direccion')} />
          )
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageCircleIcon className="size-10 opacity-50" />
            <p className="text-sm">{t('empty_panel')}</p>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Panel "iniciar": el admin seleccionó un tutor que aún no tiene hilo
 * `(admin=auth.uid(), tutor=usuario_id)`. Renderiza un header con badge
 * "Dirección" + nombre del tutor + lista de hijos del centro, y el
 * `MensajeComposer` en modo `admin_familia_iniciar`. Al enviar, el
 * composer crea el hilo y manda el primer mensaje en una secuencia de 2
 * actions; el `router.refresh()` posterior recarga la lista y el SSR
 * vuelve a montar este panel con `detalleHeader` poblado, pasando a la
 * vista `ConversacionAdminFamiliaView` con los mensajes.
 */
function PanelIniciar({
  locale,
  tutor,
  tBadge,
}: {
  locale: string
  tutor: TutorDireccionItem
  tBadge: string
}) {
  const t = useTranslations('messages.admin_direccion')
  const hijosLabel = tutor.hijos.map((h) => `${h.nombre} ${h.apellidos}`).join(', ')
  return (
    <div className="flex h-full flex-col">
      <header className="bg-background flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <ShieldCheckIcon className="size-3" />
              {tBadge}
            </Badge>
            <h2 className="truncate text-sm font-semibold">{tutor.nombre_completo}</h2>
          </div>
          {hijosLabel && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              <span className="mr-1 font-medium">
                {tutor.hijos.length === 1 ? t('hijos_label_uno') : t('hijos_label_varios')}
              </span>
              {hijosLabel}
            </p>
          )}
        </div>
      </header>

      <div
        className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
        data-testid="panel-iniciar-empty"
      >
        <p className="text-foreground text-sm font-medium">{t('iniciar_titulo')}</p>
        <p className="text-muted-foreground text-xs">{t('iniciar_subtitulo')}</p>
      </div>

      <MensajeComposer mode="admin_familia_iniciar" tutorId={tutor.usuario_id} locale={locale} />
    </div>
  )
}

/**
 * Normaliza string para búsqueda: NFD descompone caracteres acentuados,
 * la regex elimina diacríticos, lowercase. "Lucía" → "lucia".
 */
const DIACRITICS_RE = /[̀-ͯ]/g
function norm(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase()
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

/**
 * "hace 5 min" / "ayer 14:00" / "lun 14:00" / "12/05" — formato corto
 * tipo WhatsApp. Solo Intl.* nativo. Replica del helper en
 * `ConversacionesSplitView.tsx` (no se extrajo porque ambas vistas son
 * client components y la duplicación es mínima; centralizar implicaría
 * un shared module para 18 líneas).
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
