'use client'

import { diasDeSemana, parseYmd, ymd } from '../lib/fechas'
import type { CitaAgenda, VistaAgenda } from '../types'

import { ColumnaDia, RejillaHoraria } from './RejillaHoraria'

interface Props {
  vista: Extract<VistaAgenda, 'dia' | 'semana'>
  fecha: string
  citas: CitaAgenda[]
  locale: string
  onClickCita?: (cita: CitaAgenda) => void
}

const HOY = ymd(new Date())

function fmtDia(
  fecha: string,
  locale: string,
  conDiaSemana: boolean
): { label: string; sub?: string } {
  const d = parseYmd(fecha)
  const tag = locale === 'en' ? 'en-GB' : locale === 'va' ? 'ca-ES' : 'es-ES'
  if (conDiaSemana) {
    return {
      label: new Intl.DateTimeFormat(tag, { weekday: 'short' }).format(d),
      sub: new Intl.DateTimeFormat(tag, { day: '2-digit', month: 'short' }).format(d),
    }
  }
  return {
    label: new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }).format(
      d
    ),
  }
}

/** Vista día (1 columna) o semana (7) sobre la rejilla horaria. */
export function AgendaDia({ vista, fecha, citas, locale, onClickCita }: Props) {
  const fechas = vista === 'dia' ? [fecha] : diasDeSemana(fecha)
  const columnas: ColumnaDia[] = fechas.map((f) => {
    const { label, sub } = fmtDia(f, locale, vista === 'semana')
    return {
      fecha: f,
      label,
      sublabel: sub,
      hoy: f === HOY,
      citas: citas
        .filter((c) => c.fecha === f)
        .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio)),
    }
  })

  return <RejillaHoraria columnas={columnas} onClickCita={onClickCita} />
}
