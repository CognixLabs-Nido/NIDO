'use client'

import { MegaphoneIcon, MessageCircleIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import type { NinoMensajeriaItem } from '../queries/get-ninos-mensajeria'
import type { AnuncioListItem, ConversacionHeader, MensajeView } from '../types'

import { ConversacionesSplitView } from './ConversacionesSplitView'

interface Props {
  locale: string
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  ninos: NinoMensajeriaItem[]
  anuncios: AnuncioListItem[]
  puedePublicarAnuncio: boolean
  /** Niño seleccionado en la URL (?nino=X) o auto-seleccionado por SSR. */
  ninoSeleccionadoId: string | null
  /**
   * Si es false, el split-view oculta la sidebar de niños y muestra solo
   * el panel de conversación. Caso típico: tutor con un solo hijo — no
   * tiene sentido una lista de uno, ni el buscador.
   */
  mostrarListaConversaciones: boolean
  detalleHeader: ConversacionHeader | null
  detalleMensajes: MensajeView[]
  participo: boolean
}

/**
 * Vista principal `/messages` post-Bug 3:
 *  - Admin: solo tab Anuncios (no participa en conversaciones).
 *  - Profe/Tutor: tabs Conversaciones (split-view WhatsApp-style) + Anuncios.
 *
 * Tabs controladas por URL (`?tab=anuncios|conversaciones`) para deep-link.
 */
export function MessagesView({
  locale,
  rol,
  ninos,
  anuncios,
  puedePublicarAnuncio,
  ninoSeleccionadoId,
  mostrarListaConversaciones,
  detalleHeader,
  detalleMensajes,
  participo,
}: Props) {
  const t = useTranslations('messages')
  const router = useRouter()
  const searchParams = useSearchParams()

  const tabActual = searchParams.get('tab') === 'anuncios' ? 'anuncios' : 'conversaciones'

  const onTabChange = useCallback(
    (v: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (v === 'anuncios') {
        params.set('tab', 'anuncios')
        params.delete('nino')
      } else {
        params.delete('tab')
      }
      const qs = params.toString()
      router.push(`/${locale}/messages${qs ? `?${qs}` : ''}`)
    },
    [locale, router, searchParams]
  )

  const unreadConversaciones = ninos.reduce((acc, n) => acc + (n.unread_count > 0 ? 1 : 0), 0)
  const unreadAnuncios = anuncios.filter((a) => !a.leido && !a.erroneo && !a.es_propio).length

  // Realtime: si llegan mensajes/anuncios nuevos vía RLS, refrescamos el SSR
  // para que los conteos y la lista se actualicen sin recargar manualmente.
  useMessagingRealtime({
    channel: `messages-view-${locale}`,
    onChange: () => router.refresh(),
  })

  // Vista admin: sin tabs, solo anuncios (decisión F5 — admin no
  // participa en conversaciones; los tutores escriben a la profe del
  // aula). El bloque mantiene la cabecera + botón "Nuevo anuncio".
  if (rol === 'admin') {
    return (
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('subtitle_admin')}</p>
          </div>
          {puedePublicarAnuncio && (
            <Button render={<Link href={`/${locale}/messages/nuevo-anuncio`} />}>
              <MegaphoneIcon className="size-4" />
              <PlusIcon className="size-3" />
              <span className="ml-1">{t('anuncio.nuevo')}</span>
            </Button>
          )}
        </header>

        <AnunciosList anuncios={anuncios} locale={locale} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </header>

      <Tabs value={tabActual} onValueChange={onTabChange}>
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="conversaciones">
              <MessageCircleIcon className="size-4" />
              <span>{t('tabs.conversaciones')}</span>
              {unreadConversaciones > 0 && (
                <Badge variant="default" className="ml-2 px-1.5 text-[10px]">
                  {unreadConversaciones}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="anuncios">
              <MegaphoneIcon className="size-4" />
              <span>{t('tabs.anuncios')}</span>
              {unreadAnuncios > 0 && (
                <Badge variant="default" className="ml-2 px-1.5 text-[10px]">
                  {unreadAnuncios}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
          {tabActual === 'anuncios' && puedePublicarAnuncio && (
            <Button render={<Link href={`/${locale}/messages/nuevo-anuncio`} />}>
              <MegaphoneIcon className="size-4" />
              <PlusIcon className="size-3" />
              <span className="ml-1">{t('anuncio.nuevo')}</span>
            </Button>
          )}
        </div>

        <TabsContent value="conversaciones" className="pt-3">
          <ConversacionesSplitView
            locale={locale}
            rol={rol}
            ninos={ninos}
            ninoSeleccionadoId={ninoSeleccionadoId}
            mostrarLista={mostrarListaConversaciones}
            detalleHeader={detalleHeader}
            detalleMensajes={detalleMensajes}
            participo={participo}
          />
        </TabsContent>

        <TabsContent value="anuncios" className="pt-3">
          <AnunciosList anuncios={anuncios} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AnunciosList({ anuncios, locale }: { anuncios: AnuncioListItem[]; locale: string }) {
  const t = useTranslations('messages')

  if (anuncios.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-8 text-center text-sm">
          {t('lista.vacia_anuncios')}
        </CardContent>
      </Card>
    )
  }
  return (
    <ul className="space-y-2">
      {anuncios.map((a) => (
        <li key={a.id}>
          <Link
            href={`/${locale}/messages/anuncios/${a.id}`}
            className="hover:bg-muted/40 block rounded-lg border p-4 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {a.ambito === 'aula'
                      ? t('anuncio.destinatario_aula', { nombre: a.aula_nombre ?? '' })
                      : t('anuncio.destinatario_centro')}
                  </Badge>
                  {a.erroneo && (
                    <Badge variant="outline" className="text-[10px]">
                      {t('estado.anulado')}
                    </Badge>
                  )}
                </div>
                <h3
                  className={cn(
                    'mt-1 truncate font-medium',
                    a.erroneo && 'text-muted-foreground line-through'
                  )}
                >
                  {a.titulo}
                </h3>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{a.contenido}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <time className="text-muted-foreground text-xs" dateTime={a.created_at}>
                  {new Intl.DateTimeFormat(locale, {
                    day: '2-digit',
                    month: '2-digit',
                  }).format(new Date(a.created_at))}
                </time>
                {!a.leido && !a.erroneo && !a.es_propio && (
                  <span className="bg-primary inline-block h-2 w-2 rounded-full" aria-hidden />
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
