'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { esHoy, formatearFechaHumano, offsetDias } from '../lib/fecha'

interface AgendaDayPickerProps {
  fecha: string
  locale: string
  onChange: (fecha: string) => void
  /** True si la fecha actual NO es hoy (cierra inputs aguas abajo). */
  diaCerrado: boolean
  /** "Volver a hoy" opcional, visible solo si día != hoy. */
  hoy: string
}

export function AgendaDayPicker({
  fecha,
  locale,
  onChange,
  diaCerrado,
  hoy,
}: AgendaDayPickerProps) {
  const t = useTranslations('agenda')
  const puedeAvanzar = !esHoy(fecha)
  const etiqueta = formatearFechaHumano(fecha, locale)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('selector.anterior')}
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
        aria-label={t('selector.siguiente')}
        onClick={() => puedeAvanzar && onChange(offsetDias(fecha, 1))}
        disabled={!puedeAvanzar}
        aria-disabled={!puedeAvanzar}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
      {diaCerrado && <Badge variant="secondary">{t('dia_cerrado')}</Badge>}
      {fecha !== hoy && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(hoy)}>
          {t('volver_a_hoy')}
        </Button>
      )}
    </div>
  )
}
