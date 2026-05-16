import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CalendarioMensual } from '../CalendarioMensual'

/**
 * Tests del componente genérico <CalendarioMensual />.
 * Verifica que es agnóstico de dominio: nada de `dias_centro` aquí.
 */

function renderCalendario(overrides: Partial<Parameters<typeof CalendarioMensual>[0]> = {}) {
  const props = {
    mes: 6,
    anio: 2026,
    renderDia: (fecha: Date) => (
      <span data-testid={`contenido-${fecha.toISOString().slice(0, 10)}`}>{fecha.getDate()}</span>
    ),
    ...overrides,
  }
  return render(<CalendarioMensual {...props} />)
}

describe('<CalendarioMensual />', () => {
  it('renderiza 42 celdas para cualquier mes', () => {
    renderCalendario({ mes: 6, anio: 2026 })
    const cells = screen.getAllByRole('gridcell')
    expect(cells).toHaveLength(42)
  })

  it('primera celda = día 1 del mes cuando el día 1 es lunes (jun 2026)', () => {
    // Junio 2026: el día 1 es lunes (ISODOW=1) → la primera celda ES el día 1.
    renderCalendario({ mes: 6, anio: 2026 })
    const cells = screen.getAllByRole('gridcell')
    expect(cells[0].getAttribute('data-testid')).toBe('celda-2026-06-01')
  })

  it('primera celda = lunes anterior cuando el día 1 cae en otro día (may 2026)', () => {
    // Mayo 2026: el día 1 es viernes (ISODOW=5) → primera celda es el lunes anterior, 27 abr 2026.
    renderCalendario({ mes: 5, anio: 2026 })
    const cells = screen.getAllByRole('gridcell')
    expect(cells[0].getAttribute('data-testid')).toBe('celda-2026-04-27')
  })

  it('marca dentroDelMes=true para días del mes y false para overflow', () => {
    const calls: Array<{ fecha: string; dentroDelMes: boolean }> = []
    renderCalendario({
      mes: 6,
      anio: 2026,
      renderDia: (fecha, dentroDelMes) => {
        calls.push({
          fecha: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`,
          dentroDelMes,
        })
        return <span>{fecha.getDate()}</span>
      },
    })
    // 30 días en junio + overflow para llegar a 42
    const dentro = calls.filter((c) => c.dentroDelMes)
    const fuera = calls.filter((c) => !c.dentroDelMes)
    expect(dentro.length).toBe(30)
    expect(fuera.length).toBe(42 - 30)
    expect(dentro.every((c) => c.fecha.startsWith('2026-06-'))).toBe(true)
  })

  it('onClickDia se invoca con la fecha correcta al hacer click simple', () => {
    const onClickDia = vi.fn()
    renderCalendario({ mes: 6, anio: 2026, onClickDia })
    fireEvent.click(screen.getByTestId('celda-2026-06-15'))
    expect(onClickDia).toHaveBeenCalledTimes(1)
    const arg = onClickDia.mock.calls[0][0] as Date
    expect(arg.getFullYear()).toBe(2026)
    expect(arg.getMonth()).toBe(5)
    expect(arg.getDate()).toBe(15)
  })

  it('onSeleccionRango se invoca con desde<=hasta tras shift+click', () => {
    const onSeleccionRango = vi.fn()
    const diaActivo = new Date(2026, 5, 20)
    renderCalendario({ mes: 6, anio: 2026, onSeleccionRango, diaActivo })
    // Shift+click sobre una fecha ANTERIOR al diaActivo (2026-06-20) → desde=10, hasta=20
    fireEvent.click(screen.getByTestId('celda-2026-06-10'), { shiftKey: true })
    expect(onSeleccionRango).toHaveBeenCalledTimes(1)
    const [desde, hasta] = onSeleccionRango.mock.calls[0] as [Date, Date]
    expect(desde.getDate()).toBe(10)
    expect(hasta.getDate()).toBe(20)
  })

  it('onCambioMes se invoca al pulsar prev/next y avanza/retrocede el mes', () => {
    const onCambioMes = vi.fn()
    renderCalendario({ mes: 6, anio: 2026, onCambioMes })

    fireEvent.click(screen.getByTestId('calendario-next'))
    expect(onCambioMes).toHaveBeenLastCalledWith(7, 2026)

    fireEvent.click(screen.getByTestId('calendario-prev'))
    expect(onCambioMes).toHaveBeenLastCalledWith(5, 2026)
  })

  it('flecha derecha sobre el último día del mes salta al mes siguiente', () => {
    const onCambioMes = vi.fn()
    const onClickDia = vi.fn()
    // junio 30 es martes; flecha derecha → 1 jul (julio 2026)
    renderCalendario({
      mes: 6,
      anio: 2026,
      diaActivo: new Date(2026, 5, 30),
      onCambioMes,
      onClickDia,
    })
    const celda = screen.getByTestId('celda-2026-06-30')
    fireEvent.keyDown(celda, { key: 'ArrowRight' })
    expect(onCambioMes).toHaveBeenCalledWith(7, 2026)
    const arg = onClickDia.mock.calls[0][0] as Date
    expect(arg.getMonth()).toBe(6) // julio
    expect(arg.getDate()).toBe(1)
  })

  it('aria-current="date" marca el día de hoy', () => {
    // Renderizamos el mes actual y verificamos que el día de hoy lleva
    // aria-current="date".
    const hoy = new Date()
    renderCalendario({ mes: hoy.getMonth() + 1, anio: hoy.getFullYear() })
    const tag = `celda-${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
    const celdaHoy = screen.getByTestId(tag)
    expect(celdaHoy.getAttribute('aria-current')).toBe('date')
  })

  it('navegación con prev deshabilitada si no se pasa onCambioMes', () => {
    renderCalendario({ mes: 6, anio: 2026 })
    const prev = screen.getByTestId('calendario-prev')
    expect(prev).toBeDisabled()
  })

  it('rangoSeleccionado marca las celdas dentro del rango con data-en-rango=true', () => {
    renderCalendario({
      mes: 6,
      anio: 2026,
      rangoSeleccionado: { desde: new Date(2026, 5, 5), hasta: new Date(2026, 5, 10) },
    })
    expect(screen.getByTestId('celda-2026-06-05').getAttribute('data-en-rango')).toBe('true')
    expect(screen.getByTestId('celda-2026-06-07').getAttribute('data-en-rango')).toBe('true')
    expect(screen.getByTestId('celda-2026-06-10').getAttribute('data-en-rango')).toBe('true')
    // Fuera del rango
    expect(screen.getByTestId('celda-2026-06-04').getAttribute('data-en-rango')).toBe('false')
    expect(screen.getByTestId('celda-2026-06-11').getAttribute('data-en-rango')).toBe('false')
  })
})
