'use client'

import { ShieldCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { AdminFamiliaListItem as AdminFamiliaListItemType } from '../types'

interface Props {
  locale: string
  item: AdminFamiliaListItemType
}

/**
 * Item visual de un hilo admin_familia. Reutilizable en:
 *
 *  - Tab "Dirección" del `/messages` del admin (lista de sus hilos).
 *  - Sección "Dirección" del tab Conversaciones del tutor (0 ó 1 item).
 *
 * Click → navega a `/messages/conversacion/{id}`. La página detecta el
 * tipo de conversación y dispatcha al componente correcto.
 */
export function AdminFamiliaListItem({ locale, item }: Props) {
  const t = useTranslations('messages.admin_familia')
  const tBadge = useTranslations('messages.badge')

  // Snapshot `Date.now()` al montar — react-hooks/purity prohíbe la
  // llamada en el body del componente; el spec no exige countdown.
  const [nowMs] = useState(() => Date.now())
  const caducada = Date.parse(item.expires_at) <= nowMs
  const fechaCorta = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(item.expires_at))

  return (
    <Link
      href={`/${locale}/messages/conversacion/${item.id}`}
      className="hover:bg-muted/40 block rounded-lg border p-4 transition-colors"
      data-testid={`admin-familia-list-item-${item.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <ShieldCheckIcon className="size-3" />
              {tBadge('direccion')}
            </Badge>
            <h3 className={cn('truncate font-medium', item.unread_count > 0 && 'font-semibold')}>
              {item.contraparte_nombre}
            </h3>
          </div>
          {item.last_message_preview && (
            <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
              {item.last_message_preview}
            </p>
          )}
          <p
            className={cn('mt-1 text-xs', caducada ? 'text-warning-700' : 'text-muted-foreground')}
          >
            {caducada
              ? t('indicador_cerrada', { fecha: fechaCorta })
              : t('indicador_activo', { fecha: fechaCorta })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.last_message_at && (
            <time className="text-muted-foreground text-xs" dateTime={item.last_message_at}>
              {new Intl.DateTimeFormat(locale, {
                day: '2-digit',
                month: '2-digit',
              }).format(new Date(item.last_message_at))}
            </time>
          )}
          {item.unread_count > 0 && (
            <Badge variant="default" className="px-1.5 text-[10px]">
              {item.unread_count}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  )
}
