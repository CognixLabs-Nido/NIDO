'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatearFechaHumano, offsetDias } from '@/features/agenda-diaria/lib/fecha'

import type { ModoFecha } from './modo-fecha'

/**
 * DayPicker compartido para superficies operativas que necesitan tres modos
 * (hoy / histórico / futuro). Permite avanzar a fechas futuras (a diferencia
 * del `AgendaDayPicker` de F3, que solo permite ir hasta hoy).
 *
 * Lee strings del namespace i18n `day_picker.*` para que el componente sea
 * neutro: F4 (asistencia) y F4.5 (comida) lo usan sin pasarle textos.
 */
interface ModalidadDayPickerProps {
  fecha: string
  locale: string
  hoy: string
  modo: ModoFecha
  onChange: (fecha: string) => void
}

export function ModalidadDayPicker({
  fecha,
  locale,
  hoy,
  modo,
  onChange,
}: ModalidadDayPickerProps) {
  const t = useTranslations('day_picker')
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
      {modo === 'historico' && (
        <Badge variant="secondary" data-testid="badge-dia-cerrado">
          {t('dia_cerrado')}
        </Badge>
      )}
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
