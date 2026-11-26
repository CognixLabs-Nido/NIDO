'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { ContadorNoLeido } from '@/shared/components/ContadorNoLeido'

interface Props {
  /** Conteo de cambios pendientes calculado server-side (RLS limita al centro del admin). */
  /** `null`: no se pudo contar (censo C): pinta «?», nunca un 0. */
  total: number | null
}

/**
 * F11-G-3 — badge "N cambios pendientes" del item "Validaciones" del sidebar admin. Sin push
 * ni Realtime (decisión J: solo aviso in-app): el conteo se recalcula en cada render del
 * layout (navegación). Se oculta cuando no hay pendientes.
 */
export function CambiosPendientesBadge({ total }: Props) {
  const t = useTranslations('admin.pendientes')
  if (total === null) return <ContadorNoLeido />
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
