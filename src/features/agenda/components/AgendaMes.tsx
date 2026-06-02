'use client'

import { useTranslations } from 'next-intl'

import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'
import type { CalendarioLocale } from '@/shared/components/calendario/types'

import { parseYmd, ymd } from '../lib/fechas'
import type { CitaAgenda } from '../types'

const TIPO_PUNTO: Record<CitaAgenda['tipo'], string> = {
  reunion_familia: 'bg-blue-400',
  reunion_clase: 'bg-violet-400',
  reunion_claustro: 'bg-amber-400',
  visita: 'bg-emerald-400',
}

interface Props {
  fecha: string
  citas: CitaAgenda[]
  locale: string
  /** Click en un día: prefija la fecha del alta (patrón Calendario, AG-09). */
  onClickDia?: (fecha: string) => void
  onCambioMes: (fecha: string) => void
}

/**
 * Vista mes: reusa `<CalendarioMensual/>` y pinta las citas por celda (AG-06).
 * Las celdas envuelven en `<button>` (CalendarioMensual), así que los chips son
 * `<span>` display-only; el detalle/RSVP por cita llega en B5. El click en el día
 * abre el alta con la fecha prefijada.
 */
export function AgendaMes({ fecha, citas, locale, onClickDia, onCambioMes }: Props) {
  const t = useTranslations('citas')
  const tCal = useTranslations('agenda.selector')
  const ancla = parseYmd(fecha)
  const mes = ancla.getMonth() + 1
  const anio = ancla.getFullYear()

  const porDia = new Map<string, CitaAgenda[]>()
  for (const c of citas) {
    const arr = porDia.get(c.fecha) ?? []
    arr.push(c)
    porDia.set(c.fecha, arr)
  }

  return (
    <CalendarioMensual
      mes={mes}
      anio={anio}
      locale={locale as CalendarioLocale}
      ariaLabel={t('vista.mes')}
      labels={{ anterior: tCal('anterior'), siguiente: tCal('siguiente') }}
      onCambioMes={(m, a) => onCambioMes(ymd(new Date(a, m - 1, 1)))}
      onClickDia={(d) => onClickDia?.(ymd(d))}
      renderDia={(d, dentro) => {
        const delDia = (porDia.get(ymd(d)) ?? []).sort((a, b) =>
          a.hora_inicio.localeCompare(b.hora_inicio)
        )
        return (
          <div
            className={`flex h-full flex-col gap-0.5 rounded-md border p-1 ${
              dentro ? 'border-border' : 'border-transparent bg-transparent'
            }`}
          >
            <span className="text-foreground text-sm font-medium">{d.getDate()}</span>
            {delDia.slice(0, 3).map((c) => (
              <span
                key={c.id}
                className={`flex items-center gap-1 truncate text-[10px] ${
                  c.estado === 'cancelada' ? 'line-through opacity-60' : ''
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIPO_PUNTO[c.tipo]}`} />
                <span className="truncate">
                  {c.hora_inicio.slice(0, 5)} {c.titulo}
                </span>
              </span>
            ))}
            {delDia.length > 3 && (
              <span className="text-muted-foreground text-[10px]">+{delDia.length - 3}</span>
            )}
          </div>
        )
      }}
    />
  )
}
