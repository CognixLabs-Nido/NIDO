'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatearFechaHumano, offsetDias } from '@/features/agenda-diaria/lib/fecha'

export type ModoFechaServicio = 'hoy' | 'historico' | 'futuro'

interface ServicioDayPickerProps {
  fecha: string
  locale: string
  hoy: string
  modo: ModoFechaServicio
  onChange: (fecha: string) => void
}

/**
 * Selector de día del parte de servicio. Hoy y días pasados editan (corregir
 * olvidos antes del cierre del mes); el futuro se muestra en solo lectura.
 */
export function ServicioDayPicker({ fecha, locale, hoy, modo, onChange }: ServicioDayPickerProps) {
  const t = useTranslations('parte_servicio.selector')
  const etiqueta = formatearFechaHumano(fecha, locale)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('anterior')}
        onClick={() => onChange(offsetDias(fecha, -1))}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>
      <div
        className="min-w-[16ch] flex-1 text-center text-sm font-medium capitalize sm:flex-none"
        aria-live="polite"
      >
        {etiqueta}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('siguiente')}
        onClick={() => onChange(offsetDias(fecha, 1))}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      {modo === 'futuro' && (
        <Badge variant="info" data-testid="badge-dia-futuro">
          {t('dia_futuro')}
        </Badge>
      )}
      {fecha !== hoy && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(hoy)}>
          {t('volver_a_hoy')}
        </Button>
      )}
    </div>
  )
}
