'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

interface Props {
  /** Conteo de invitaciones pendientes, calculado server-side (AG-14). */
  initialTotal: number
}

/**
 * Badge de invitaciones PENDIENTES del usuario en el item "Agenda" del sidebar
 * (AG-14). Clon de `RecordatoriosBadge` **sin** la suscripción Realtime: el
 * recuento se calcula en server-render al navegar. Es **stateless** a propósito
 * — pinta el prop directo — para que refleje el recálculo del layout tras un
 * `router.refresh()` (la Agenda lo dispara al responder/gestionar un RSVP); con
 * `useState(initialTotal)` el nuevo valor no se propagaría.
 */
export function AgendaBadge({ initialTotal }: Props) {
  const t = useTranslations('citas')
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
