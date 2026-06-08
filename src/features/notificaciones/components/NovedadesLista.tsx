import {
  AlertTriangleIcon,
  CalendarRangeIcon,
  FileSignatureIcon,
  PillIcon,
  SyringeIcon,
  UsersIcon,
} from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'

import type { NovedadItem, NovedadTipo } from '../types'

const ICONO: Record<NovedadTipo, typeof CalendarRangeIcon> = {
  evento: CalendarRangeIcon,
  recogida: UsersIcon,
  medicacion: PillIcon,
  autorizacion: FileSignatureIcon,
  administracion: SyringeIcon,
  revocacion: AlertTriangleIcon,
}

/**
 * Lista del centro de notificaciones: novedades del ámbito del rol ordenadas por
 * fecha. Cada ítem es un link a su destino (calendario o detalle de autorización).
 * Marca «Nuevo» lo no leído y destaca en ámbar las administraciones pendientes de
 * la confirmación del usuario (lo principal, B). Server component.
 */
export async function NovedadesLista({ items }: { items: NovedadItem[] }) {
  const t = await getTranslations('notificaciones')
  const locale = await getLocale()
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('vacio')}</p>
  }

  return (
    <ul className="space-y-2">
      {items.map((n) => {
        const Icono = ICONO[n.tipo]
        const esRevocacion = n.tipo === 'revocacion'
        return (
          <li key={n.key}>
            <Link
              href={n.href}
              className={`flex items-start gap-3 rounded-lg border p-3 transition hover:shadow-sm ${
                esRevocacion
                  ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30'
                  : 'hover:border-accent-warm-200'
              }`}
            >
              <span
                className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${
                  esRevocacion
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icono className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{n.titulo}</span>
                  {esRevocacion && (
                    <Badge variant="outline" className="text-amber-700">
                      {t('tipo.revocacion')}
                    </Badge>
                  )}
                  {n.nuevo && (
                    <Badge variant="default" className="px-1.5 text-[10px]">
                      {t('nuevo')}
                    </Badge>
                  )}
                  {n.pendienteConfirmacion && (
                    <Badge variant="outline" className="text-amber-700">
                      {t('pendiente_confirmacion')}
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs">
                  <span>{t(`tipo.${n.tipo}`)}</span>
                  {n.subtitulo && <span>· {n.subtitulo}</span>}
                  <span>· {fmt.format(new Date(n.fecha))}</span>
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
