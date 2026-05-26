'use client'

import { MegaphoneIcon, MessageCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { useMessagingRealtime } from '../lib/use-messaging-realtime'
import type { AnuncioListItem, ConversacionListItem } from '../types'

interface Props {
  locale: string
  conversaciones: ConversacionListItem[]
  anuncios: AnuncioListItem[]
}

/**
 * Vista principal /messages. Tabs Conversaciones / Anuncios con badge
 * de no leídos. Realtime sub a mensajes + anuncios refresca la lista
 * sin recargar. La ordenación de conversaciones la hace ya el server
 * (last_message_at DESC NULLS LAST); la de anuncios viene también
 * ordenada (created_at DESC).
 */
export function MessagesListView({ locale, conversaciones, anuncios }: Props) {
  const t = useTranslations('messages')
  useMessagingRealtime({ channel: `messages-list-${locale}` })

  const unreadConversaciones = conversaciones.reduce(
    (acc, c) => acc + (c.unread_count > 0 ? 1 : 0),
    0
  )
  const unreadAnuncios = anuncios.filter((a) => !a.leido && !a.erroneo && !a.es_propio).length

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </header>

      <Tabs defaultValue="conversaciones">
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

        <TabsContent value="conversaciones" className="space-y-2 pt-3">
          {conversaciones.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                {t('lista.vacia_conversaciones')}
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {conversaciones.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/${locale}/messages/conversacion/${c.id}`}
                    className="hover:bg-muted/40 block rounded-lg border p-4 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {c.nino_nombre} {c.nino_apellidos}
                          </span>
                          {c.aula_nombre && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {t('lista.aula_label', { nombre: c.aula_nombre })}
                            </Badge>
                          )}
                        </div>
                        <p
                          className={cn(
                            'text-muted-foreground mt-1 truncate text-sm',
                            c.last_message_preview === null && 'italic'
                          )}
                        >
                          {c.last_message_preview ??
                            (c.last_message_at
                              ? t('lista.preview_anulado')
                              : t('lista.sin_preview'))}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {c.last_message_at && (
                          <time
                            className="text-muted-foreground text-xs"
                            dateTime={c.last_message_at}
                          >
                            {new Intl.DateTimeFormat(locale, {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit',
                            }).format(new Date(c.last_message_at))}
                          </time>
                        )}
                        {c.unread_count > 0 && (
                          <Badge
                            variant="default"
                            className="px-1.5 text-[10px]"
                            aria-label={t('lista.no_leidos', { n: c.unread_count })}
                          >
                            {c.unread_count > 9 ? '9+' : c.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="anuncios" className="space-y-2 pt-3">
          {anuncios.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                {t('lista.vacia_anuncios')}
              </CardContent>
            </Card>
          ) : (
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
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                          {a.contenido}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <time className="text-muted-foreground text-xs" dateTime={a.created_at}>
                          {new Intl.DateTimeFormat(locale, {
                            day: '2-digit',
                            month: '2-digit',
                          }).format(new Date(a.created_at))}
                        </time>
                        {!a.leido && !a.erroneo && !a.es_propio && (
                          <span
                            className="bg-primary inline-block h-2 w-2 rounded-full"
                            aria-hidden
                          />
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
