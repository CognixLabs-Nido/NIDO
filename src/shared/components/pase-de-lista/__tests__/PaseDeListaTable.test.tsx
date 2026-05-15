import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { PaseDeListaTable } from '../PaseDeListaTable'
import type { PaseDeListaItem, PaseDeListaTableProps } from '../types'

/**
 * Tests del componente genérico <PaseDeListaTable />.
 * NinoSimulado / valor simplificado para que los tests no dependan de
 * ningún feature concreto (ADR-0014: componente reutilizable).
 */

interface NinoSimulado {
  id: string
  nombre: string
}

type ValorAsistencia = {
  estado: 'presente' | 'ausente' | 'llegada_tarde'
  hora_llegada: string | null
  observaciones: string | null
}

const NINOS: NinoSimulado[] = [
  { id: 'n1', nombre: 'Niño A' },
  { id: 'n2', nombre: 'Niño B' },
]

const i18n = {
  pending: 'Pendiente',
  dirty: 'Sin guardar',
  saved: 'Guardado',
  errorRow: 'Error',
} as const

function renderTable(
  overrides: Partial<PaseDeListaTableProps<NinoSimulado, ValorAsistencia>> = {}
) {
  const items: Array<PaseDeListaItem<NinoSimulado, ValorAsistencia>> = NINOS.map((n) => ({
    id: n.id,
    item: n,
    initial: null,
  }))

  const props: PaseDeListaTableProps<NinoSimulado, ValorAsistencia> = {
    items,
    renderItem: (n) => <span>{n.nombre}</span>,
    columns: [
      {
        id: 'estado',
        label: 'Estado',
        type: 'radio',
        options: [
          { value: 'presente', label: 'Presente' },
          { value: 'ausente', label: 'Ausente' },
          { value: 'llegada_tarde', label: 'Tarde' },
        ],
        zod: z.enum(['presente', 'ausente', 'llegada_tarde'], {
          message: 'estado requerido',
        }),
      },
      {
        id: 'hora_llegada',
        label: 'Hora',
        type: 'time',
        visibleWhen: (r) => r.estado === 'presente' || r.estado === 'llegada_tarde',
      },
      { id: 'observaciones', label: 'Notas', type: 'text-short' },
    ],
    quickActions: [
      {
        id: 'presentes',
        label: 'Marcar todos presentes',
        apply: (r) => ({ ...r, estado: 'presente', hora_llegada: r.hora_llegada ?? '09:00' }),
      },
    ],
    onBatchSubmit: vi.fn(async () => ({ success: true })),
    submitLabel: 'Guardar',
    i18n,
    ...overrides,
  }

  return { props, ...render(<PaseDeListaTable {...props} />) }
}

describe('<PaseDeListaTable /> — componente genérico de pase de lista', () => {
  it('renderiza N filas con renderItem y status pending por defecto', () => {
    renderTable()
    expect(screen.getByText('Niño A')).toBeInTheDocument()
    expect(screen.getByText('Niño B')).toBeInTheDocument()
    const statusA = screen.getByTestId('pase-status-n1')
    expect(statusA).toHaveAttribute('data-status', 'pending')
    expect(within(statusA).getByText('Pendiente')).toBeInTheDocument()
  })

  it('setValue marca la fila como dirty al hacer click en una opción radio', () => {
    renderTable()
    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-ausente'))
    const status = screen.getByTestId('pase-status-n1')
    expect(status).toHaveAttribute('data-status', 'dirty')
  })

  it('aplica quick action a TODAS las filas marcándolas dirty', () => {
    renderTable()
    fireEvent.click(screen.getByTestId('pase-quick-presentes'))
    expect(screen.getByTestId('pase-status-n1')).toHaveAttribute('data-status', 'dirty')
    expect(screen.getByTestId('pase-status-n2')).toHaveAttribute('data-status', 'dirty')
  })

  it('botón submit deshabilitado si no hay filas dirty', () => {
    renderTable()
    expect(screen.getByTestId('pase-submit')).toBeDisabled()
  })

  it('onBatchSubmit recibe solo las filas dirty con sus valores', async () => {
    const onBatchSubmit = vi.fn(async () => ({ success: true }))
    renderTable({ onBatchSubmit })

    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-presente'))
    // Tras seleccionar presente, la columna hora_llegada se hace visible.
    const horaInput = screen.getByTestId('pase-cell-n1-hora_llegada')
    fireEvent.change(horaInput, { target: { value: '09:15' } })

    fireEvent.click(screen.getByTestId('pase-submit'))

    await waitFor(() => expect(onBatchSubmit).toHaveBeenCalledOnce())
    const rows = onBatchSubmit.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('n1')
    expect(rows[0].value.estado).toBe('presente')
    expect(rows[0].value.hora_llegada).toBe('09:15')
  })

  it('marca como saved tras submit exitoso', async () => {
    renderTable()
    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-ausente'))
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('pase-status-n1')).toHaveAttribute('data-status', 'saved')
    )
  })

  it('marca como error y muestra mensaje global tras submit fallido', async () => {
    const onBatchSubmit = vi.fn(async () => ({ success: false, error: 'kaput' }))
    renderTable({ onBatchSubmit })
    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-ausente'))
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('pase-status-n1')).toHaveAttribute('data-status', 'error')
    )
    expect(screen.getByRole('alert')).toHaveTextContent('kaput')
  })

  it('readOnly oculta quick actions y el botón submit, y deshabilita inputs', () => {
    renderTable({ readOnly: true })
    expect(screen.queryByTestId('pase-quick-presentes')).toBeNull()
    expect(screen.queryByTestId('pase-submit')).toBeNull()
    // Los inputs time/text estan disabled; los botones radio también.
    const radio = screen.getByTestId('pase-cell-n1-estado-presente')
    expect(radio).toBeDisabled()
  })

  it('columna visibleWhen oculta la celda si no se cumple la condición', () => {
    renderTable()
    // Sin estado seleccionado, hora_llegada no es visible inicialmente.
    expect(screen.queryByTestId('pase-cell-n1-hora_llegada')).toBeNull()
    // Al marcar ausente (no presente/tarde), tampoco aparece.
    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-ausente'))
    expect(screen.queryByTestId('pase-cell-n1-hora_llegada')).toBeNull()
    // Al marcar presente, sí aparece.
    fireEvent.click(screen.getByTestId('pase-cell-n1-estado-presente'))
    expect(screen.getByTestId('pase-cell-n1-hora_llegada')).toBeInTheDocument()
  })

  it('badges informativos se renderizan junto al item', () => {
    const items: Array<PaseDeListaItem<NinoSimulado, ValorAsistencia>> = [
      {
        id: 'n1',
        item: NINOS[0],
        initial: null,
        badges: [{ label: 'Ausencia reportada', variant: 'warm' }],
      },
    ]
    renderTable({ items })
    expect(screen.getByTestId('pase-badge-n1-0')).toHaveTextContent('Ausencia reportada')
  })
})
