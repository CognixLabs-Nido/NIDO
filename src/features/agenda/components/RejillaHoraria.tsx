'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'

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
}

/**
 * Rejilla horaria compartida por las vistas día (1 columna) y semana (7). Filas
 * = horas de la jornada de guardería (no 24h). Cada cita se ubica en la fila de
 * su `hora_inicio` (clampada al rango). Lista por celda, sin solapamiento
 * pixel-perfect (eso es Ola 3).
 */
export function RejillaHoraria({ columnas, onClickCita }: Props) {
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
              return (
                <div
                  key={`${c.fecha}-${h}`}
                  className="border-border min-h-[3rem] space-y-1 border-t border-l p-1"
                >
                  {delHora.map((ci) => (
                    <CitaChip key={ci.id} cita={ci} onClick={onClickCita} />
                  ))}
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
