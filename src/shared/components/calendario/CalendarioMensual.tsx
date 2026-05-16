'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'

import type { CalendarioLocale, CalendarioMensualProps } from './types'

const LOCALE_MAP: Record<CalendarioLocale, string> = {
  es: 'es-ES',
  en: 'en-GB',
  va: 'ca-ES',
}

function intlLocale(locale: CalendarioLocale | undefined): string {
  return LOCALE_MAP[locale ?? 'es']
}

/**
 * Devuelve la fecha de la primera celda del grid (lunes anterior o igual
 * al día 1 del mes). El grid siempre tiene 42 celdas (7×6 semanas) — algunas
 * son del mes anterior/siguiente y se marcan con `dentroDelMes=false`.
 */
function primeraCeldaDelGrid(anio: number, mes: number): Date {
  const dia1 = new Date(anio, mes - 1, 1)
  // ISO: lunes=1 ... domingo=7. JS getDay: domingo=0 ... sábado=6.
  const isoDow = dia1.getDay() === 0 ? 7 : dia1.getDay()
  const desplazamiento = isoDow - 1
  const inicio = new Date(anio, mes - 1, 1 - desplazamiento)
  inicio.setHours(0, 0, 0, 0)
  return inicio
}

function fechaSinHora(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function isoYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * `<CalendarioMensual />` — grid mensual genérico (Client).
 *
 * - 7 columnas (lun a dom, ISO), 6 filas → 42 celdas siempre.
 * - El padre decide qué pintar dentro de cada celda vía `renderDia`.
 * - Click simple → `onClickDia`. Shift+click → `onSeleccionRango(diaActivo, fecha)`.
 * - Navegación con flechas mueve `diaActivo`; en bordes salta de mes vía `onCambioMes`.
 * - `aria-current="date"` en hoy. ARIA grid + columnheader + gridcell.
 *
 * El componente es controlado: el padre mantiene `mes`/`anio`/`diaActivo` y
 * recibe callbacks. No hace fetch. No conoce `dias_centro` ni eventos.
 */
export function CalendarioMensual({
  mes,
  anio,
  renderDia,
  onClickDia,
  onSeleccionRango,
  diaActivo,
  rangoSeleccionado,
  onCambioMes,
  ariaLabel,
  locale,
  labels,
}: CalendarioMensualProps) {
  const intlTag = intlLocale(locale)
  const hoy = useMemo(() => fechaSinHora(new Date()), [])

  // Lista de 42 celdas con metadata estable. Recalcula solo cuando cambia
  // mes/año.
  const celdas = useMemo(() => {
    const inicio = primeraCeldaDelGrid(anio, mes)
    return Array.from({ length: 42 }, (_, i) => {
      const fecha = addDays(inicio, i)
      return {
        fecha,
        dentroDelMes: fecha.getMonth() === mes - 1,
      }
    })
  }, [anio, mes])

  // Cabecera con los 7 días de la semana (lun-dom) localizados.
  const cabecera = useMemo(() => {
    // Tomamos un lunes conocido (5 ene 2026 es lunes) y formateamos 7 días.
    const lunesRef = new Date(2026, 0, 5)
    const fmt = new Intl.DateTimeFormat(intlTag, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, i) => fmt.format(addDays(lunesRef, i)))
  }, [intlTag])

  const tituloMes = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlTag, { month: 'long', year: 'numeric' })
    return fmt.format(new Date(anio, mes - 1, 1))
  }, [anio, mes, intlTag])

  const fechaLargaFmt = useMemo(
    () => new Intl.DateTimeFormat(intlTag, { dateStyle: 'full' }),
    [intlTag]
  )

  const navegarMes = (delta: number): void => {
    if (!onCambioMes) return
    const fecha = new Date(anio, mes - 1 + delta, 1)
    onCambioMes(fecha.getMonth() + 1, fecha.getFullYear())
  }

  const handleClickCelda = (fecha: Date, e: MouseEvent<HTMLButtonElement>): void => {
    if (e.shiftKey && diaActivo && onSeleccionRango) {
      const desde = diaActivo < fecha ? diaActivo : fecha
      const hasta = diaActivo < fecha ? fecha : diaActivo
      onSeleccionRango(fechaSinHora(desde), fechaSinHora(hasta))
      return
    }
    onClickDia?.(fechaSinHora(fecha))
  }

  const handleKeyDown = (fecha: Date, e: KeyboardEvent<HTMLButtonElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape']
    if (!keys.includes(e.key)) return
    e.preventDefault()

    if (e.key === 'Enter' || e.key === ' ') {
      onClickDia?.(fechaSinHora(fecha))
      return
    }
    if (e.key === 'Escape') {
      // El padre controla `diaActivo`. Le mandamos un click sobre la celda
      // que ya estaba activa para que decida (típicamente lo borra).
      return
    }
    const delta =
      e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -7 : 7
    const nueva = addDays(fecha, delta)
    if (nueva.getMonth() !== mes - 1 && onCambioMes) {
      onCambioMes(nueva.getMonth() + 1, nueva.getFullYear())
    }
    onClickDia?.(fechaSinHora(nueva))
  }

  return (
    <div className="bg-card border-border/60 rounded-2xl border p-4 shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navegarMes(-1)}
          disabled={!onCambioMes}
          aria-label={labels?.anterior ?? 'Mes anterior'}
          data-testid="calendario-prev"
          className="hover:bg-muted text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <h2 className="text-h3 text-foreground capitalize">{tituloMes}</h2>
        <button
          type="button"
          onClick={() => navegarMes(1)}
          disabled={!onCambioMes}
          aria-label={labels?.siguiente ?? 'Mes siguiente'}
          data-testid="calendario-next"
          className="hover:bg-muted text-foreground inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </header>

      <div
        role="grid"
        aria-label={ariaLabel ?? tituloMes}
        data-testid="calendario-grid"
        className="grid grid-cols-7 gap-1"
      >
        {cabecera.map((nombre, i) => (
          <div
            key={`col-${i}`}
            role="columnheader"
            className="text-muted-foreground py-2 text-center text-xs font-semibold uppercase"
          >
            {nombre}
          </div>
        ))}
        {celdas.map(({ fecha, dentroDelMes }) => {
          const esHoy = mismoDia(fecha, hoy)
          const esActivo = diaActivo ? mismoDia(fecha, diaActivo) : false
          const enRango = rangoSeleccionado
            ? fecha.getTime() >=
                Math.min(rangoSeleccionado.desde.getTime(), rangoSeleccionado.hasta.getTime()) &&
              fecha.getTime() <=
                Math.max(rangoSeleccionado.desde.getTime(), rangoSeleccionado.hasta.getTime())
            : false
          const ariaCurrent = esHoy ? 'date' : undefined
          const tabIndex = esActivo ? 0 : -1
          return (
            <button
              key={isoYmd(fecha)}
              type="button"
              role="gridcell"
              aria-current={ariaCurrent}
              aria-label={fechaLargaFmt.format(fecha)}
              tabIndex={tabIndex}
              data-testid={`celda-${isoYmd(fecha)}`}
              data-dentro-mes={dentroDelMes ? 'true' : 'false'}
              data-en-rango={enRango ? 'true' : 'false'}
              onClick={(e) => handleClickCelda(fecha, e)}
              onKeyDown={(e) => handleKeyDown(fecha, e)}
              className={[
                'border-border/40 hover:bg-muted/60 focus-visible:ring-primary-300 min-h-[64px] rounded-lg border p-1 text-left transition-colors focus:outline-none focus-visible:ring-2',
                dentroDelMes ? '' : 'opacity-40',
                esActivo ? 'border-primary-500 ring-primary-300 ring-2' : '',
                enRango ? 'bg-primary-50 border-primary-400' : '',
                esHoy ? 'border-primary-400' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {renderDia(fecha, dentroDelMes)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
