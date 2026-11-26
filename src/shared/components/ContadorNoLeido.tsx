'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

/**
 * El contador de un menú que no se pudo leer (censo C, 2026-11-25): «?», nunca un 0 ni nada, que dirían
 * «no tienes pendientes». El resto del menú y de la pantalla sigue funcionando.
 */
export function ContadorNoLeido() {
  const t = useTranslations('common.lectura')
  return (
    <Badge
      variant="outline"
      className="ml-auto px-1.5 text-[10px]"
      aria-label={t('contador')}
      title={t('contador')}
      data-testid="contador-no-leido"
    >
      ?
    </Badge>
  )
}
