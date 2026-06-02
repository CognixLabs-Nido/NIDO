'use client'

import { Fragment, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

import { horaDeCita, horasJornada } from '../lib/fechas'
import type { CitaAgenda } from '../types'

import { CitaChip } from './CitaChip'

export interface ColumnaDia {
  fecha: string
  label: string
  sublabel?: string
  hoy?: boolean
  citas: CitaAgenda[]
}

interface Props {
  columnas: ColumnaDia[]
  onClickCita?: (cita: CitaAgenda) => void
  /** Clic en una franja vacía: abre el alta con la fecha y la hora de la franja. */
  onClickFranja?: (fecha: string, hora: number) => void
}

/**
 * Rejilla horaria compartida por las vistas día (1 columna) y semana (7). Filas
 * = horas de la jornada de guardería (no 24h). Cada cita se ubica en la fila de
 * su `hora_inicio` (clampada al rango). Lista por celda, sin solapamiento
 * pixel-perfect (eso es Ola 3).
 */
export function RejillaHoraria({ columnas, onClickCita, onClickFranja }: Props) {
  const t = useTranslations('citas')
  const horas = horasJornada()

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-fit"
        style={{ gridTemplateColumns: `3.5rem repeat(${columnas.length}, minmax(9rem, 1fr))` }}
      >
        {/* Cabecera: esquina + días */}
        <div className="bg-background sticky left-0 z-10" />
        {columnas.map((c) => (
          <div
            key={c.fecha}
            className={`border-border border-b px-2 py-2 text-center text-sm ${
              c.hoy ? 'text-primary font-semibold' : 'text-foreground font-medium'
            }`}
          >
            <div>{c.label}</div>
            {c.sublabel && <div className="text-muted-foreground text-xs">{c.sublabel}</div>}
          </div>
        ))}

        {/* Filas por hora */}
        {horas.map((h) => (
          <Fragment key={h}>
            <div className="text-muted-foreground border-border border-t px-1 py-1 text-right text-xs">
              {String(h).padStart(2, '0')}:00
            </div>
            {columnas.map((c) => {
              const delHora = c.citas.filter((ci) => horaDeCita(ci.hora_inicio) === h)
              const hh = `${String(h).padStart(2, '0')}:00`
              const clicable = !!onClickFranja
              return (
                <div
                  key={`${c.fecha}-${h}`}
                  className={cn(
                    'border-border min-h-[3rem] space-y-1 border-t border-l p-1',
                    clicable && 'hover:bg-accent/40 cursor-pointer'
                  )}
                  {...(clicable
                    ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        'aria-label': t('alta.nueva_en', { hora: hh }),
                        onClick: () => onClickFranja(c.fecha, h),
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onClickFranja(c.fecha, h)
                          }
                        },
                      }
                    : {})}
                >
                  {delHora.length > 0 && (
                    // Frena la propagación: pulsar una cita no debe abrir el alta de la franja.
                    <div
                      className="space-y-1"
                      role="presentation"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {delHora.map((ci) => (
                        <CitaChip key={ci.id} cita={ci} onClick={onClickCita} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
      {columnas.every((c) => c.citas.length === 0) && (
        <p className="text-muted-foreground py-6 text-center text-sm">{t('vacio')}</p>
      )}
    </div>
  )
}
