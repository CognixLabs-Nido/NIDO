'use client'

import { ArrowLeftIcon, MegaphoneIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { marcarAnuncioLeido } from '../actions/marcar-anuncio-leido'
import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import type { LectorAnuncioItem } from '../queries/get-lectores-anuncio'
import { PREFIX_ANULADO, type AnuncioDetalle } from '../types'

import { LectoresAnuncioModal } from './LectoresAnuncioModal'
import { MarcarErroneoButton } from './MarcarErroneoButton'

interface Props {
  locale: string
  anuncio: AnuncioDetalle
  /** Lista detallada de destinatarios + lectura. Solo poblada cuando el
   *  usuario actual es el autor; en caso contrario llega vacía. */
  lectoresDetalle: LectorAnuncioItem[]
}

/**
 * Detalle de un anuncio. Marca leído al montar (idempotente). Si el
 * usuario actual es el autor, muestra contador de lectura "N de M".
 */
export function AnuncioView({ locale, anuncio, lectoresDetalle }: Props) {
  const t = useTranslations('messages.anuncio')
  const tAnular = useTranslations('messages.anular')
  const tEstado = useTranslations('messages.estado')
  const router = useRouter()
  const [lectoresOpen, setLectoresOpen] = useState(false)

  useEffect(() => {
    if (anuncio.es_propio) return
    void marcarAnuncioLeido({ anuncio_id: anuncio.id })
  }, [anuncio.id, anuncio.es_propio])

  // Si el usuario es autor, abrimos un listener adicional sobre
  // `lectura_anuncio` filtrado por este anuncio para refrescar el contador
  // "X de Y" en vivo cuando los destinatarios marquen leído. La policy
  // `lectura_anuncio_select_autor` autoriza al autor a recibir esos eventos.
  // Tras quitar el `router.refresh()` automático del hook, este caller
  // necesita disparar el refresh explícitamente para que el SSR recargue
  // los contadores y el estado de anulación. Memoizamos para no rotar la
  // subscripción al re-renderizar.
  const onRealtimeChange = useCallback(() => {
    router.refresh()
  }, [router])
  useMessagingRealtime({
    channel: `messages-anuncio-${anuncio.id}`,
    anuncioIdParaLecturas: anuncio.es_propio ? anuncio.id : undefined,
    onChange: onRealtimeChange,
  })

  const tituloVisible = anuncio.erroneo
    ? anuncio.titulo.replace(PREFIX_ANULADO, '')
    : anuncio.titulo

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link
          href={`/${locale}/messages`}
          aria-label={t('volver')}
          className="text-muted-foreground hover:bg-muted/40 inline-flex h-9 w-9 items-center justify-center rounded-md"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <MegaphoneIcon className="text-muted-foreground size-5" />
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {anuncio.ambito === 'aula'
              ? t('destinatario_aula', { nombre: anuncio.aula_nombre ?? '' })
              : t('destinatario_centro')}
          </Badge>
          {anuncio.erroneo && (
            <Badge variant="outline" className="text-[10px]">
              {tEstado('anulado')}
            </Badge>
          )}
        </div>
      </header>

      {anuncio.erroneo && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive-foreground rounded-md border px-4 py-3 text-sm"
        >
          {tAnular('anuncio_banner')}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="space-y-1">
            <h1
              className={cn(
                'text-xl font-semibold',
                anuncio.erroneo && 'text-muted-foreground line-through'
              )}
            >
              {tituloVisible}
            </h1>
            <p className="text-muted-foreground text-xs">
              {t('autor_label', { nombre: anuncio.autor_nombre })} ·{' '}
              <time dateTime={anuncio.created_at}>
                {new Intl.DateTimeFormat(locale, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(anuncio.created_at))}
              </time>
            </p>
          </div>
          <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {anuncio.contenido}
          </div>

          {anuncio.es_propio && anuncio.lectores && (
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setLectoresOpen(true)}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline focus-visible:underline"
                data-testid="ver-lectores-anuncio"
                aria-label={t('ver_lectores')}
              >
                {t('lectores', {
                  n: anuncio.lectores.leidos,
                  total: anuncio.lectores.total,
                })}
              </button>
            </div>
          )}

          {anuncio.es_propio && !anuncio.erroneo && (
            <div className="border-t pt-3">
              <MarcarErroneoButton
                target="anuncio"
                id={anuncio.id}
                createdAt={anuncio.created_at}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {anuncio.es_propio && anuncio.lectores && (
        <LectoresAnuncioModal
          open={lectoresOpen}
          onOpenChange={setLectoresOpen}
          locale={locale}
          lectores={lectoresDetalle}
          total={anuncio.lectores.total}
          leidos={anuncio.lectores.leidos}
        />
      )}
    </div>
  )
}
