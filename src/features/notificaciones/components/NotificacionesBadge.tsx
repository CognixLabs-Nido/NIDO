'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

interface Props {
  /** Novedades no leídas, calculado server-side al navegar (sin Realtime). */
  initialTotal: number
}

/**
 * Badge de novedades NO LEÍDAS en el item «Notificaciones» del sidebar. Clon de
 * `AgendaBadge`: **stateless**, pinta el prop directo. Se recalcula en server-render
 * al navegar (incl. tras abrir /notifications, que sella el marcador `visto_at` y
 * baja el contador a 0).
 */
export function NotificacionesBadge({ initialTotal }: Props) {
  const t = useTranslations('notificaciones')
  if (initialTotal <= 0) return null

  const label = t('badge_aria', { n: initialTotal })

  return (
    <Badge
      variant="default"
      className="ml-auto px-1.5 text-[10px]"
      aria-label={label}
      title={label}
    >
      {initialTotal > 9 ? '9+' : initialTotal}
    </Badge>
  )
}
