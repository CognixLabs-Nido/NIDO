'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatearFechaHumano, offsetDias } from '@/features/agenda-diaria/lib/fecha'

import type { ModoFecha } from '../lib/modo-fecha'

/**
 * DayPicker propio de la asistencia: a diferencia del de la agenda, **sí**
 * permite avanzar al futuro. Hoy edita, ayer y atrás muestra histórico,
 * mañana y adelante muestra preview de ausencias ya reportadas.
 */
interface AsistenciaDayPickerProps {
  fecha: string
  locale: string
  hoy: string
  modo: ModoFecha
  onChange: (fecha: string) => void
}

export function AsistenciaDayPicker({
  fecha,
  locale,
  hoy,
  modo,
  onChange,
}: AsistenciaDayPickerProps) {
  const tAgenda = useTranslations('agenda')
  const tAsistencia = useTranslations('asistencia.vista')
  const etiqueta = formatearFechaHumano(fecha, locale)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={tAgenda('selector.anterior')}
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
        aria-label={tAgenda('selector.siguiente')}
        onClick={() => onChange(offsetDias(fecha, 1))}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      {modo === 'historico' && (
        <Badge variant="secondary" data-testid="badge-dia-cerrado">
          {tAsistencia('dia_cerrado')}
        </Badge>
      )}
      {modo === 'futuro' && (
        <Badge variant="info" data-testid="badge-dia-futuro">
          {tAsistencia('dia_futuro')}
        </Badge>
      )}
      {fecha !== hoy && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(hoy)}>
          {tAgenda('volver_a_hoy')}
        </Button>
      )}
    </div>
  )
}
