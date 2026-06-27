'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

interface Props {
  /** Conteo de cambios pendientes calculado server-side (RLS limita al centro del admin). */
  total: number
}

/**
 * F11-G-3 — badge "N cambios pendientes" del item "Validaciones" del sidebar admin. Sin push
 * ni Realtime (decisión J: solo aviso in-app): el conteo se recalcula en cada render del
 * layout (navegación). Se oculta cuando no hay pendientes.
 */
export function CambiosPendientesBadge({ total }: Props) {
  const t = useTranslations('admin.pendientes')
  if (total <= 0) return null
  const label = t('badge_aria', { n: total })
  return (
    <Badge
      variant="default"
      className="ml-auto px-1.5 text-[10px]"
      aria-label={label}
      title={label}
    >
      {total > 9 ? '9+' : total}
    </Badge>
  )
}
