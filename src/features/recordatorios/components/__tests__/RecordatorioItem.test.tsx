import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecordatorioListItem } from '../../types'

const completarMock = vi.fn()
const anularMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('../../actions/completar-recordatorio', () => ({
  completarRecordatorio: (...args: unknown[]) => completarMock(...args),
}))
vi.mock('../../actions/anular-recordatorio', () => ({
  anularRecordatorio: (...args: unknown[]) => anularMock(...args),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RecordatorioItem } from '../RecordatorioItem'

const USER = 'user-1'

function makeItem(overrides: Partial<RecordatorioListItem> = {}): RecordatorioListItem {
  return {
    id: 'rec-1',
    destinatario: 'familia',
    nino_id: 'nino-1',
    nino_nombre: 'Demo',
    titulo: 'traer pañales',
    descripcion: null,
    vencimiento: null,
    completado_en: null,
    completado_por: null,
    erroneo: false,
    creado_por: USER,
    autor_nombre: 'Admin',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    es_propio: true,
    ...overrides,
  }
}

describe('RecordatorioItem', () => {
  beforeEach(() => {
    completarMock.mockReset()
    anularMock.mockReset()
    refreshMock.mockReset()
  })

  it('pendiente reciente del emisor: muestra completar y anular', () => {
    render(<RecordatorioItem item={makeItem()} userId={USER} locale="es" />)
    expect(screen.getByTestId('recordatorio-completar')).toBeInTheDocument()
    expect(screen.getByTestId('recordatorio-anular')).toBeInTheDocument()
  })

  it('pendiente con >5 min: oculta anular pero mantiene completar', () => {
    const old = makeItem({ created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    render(<RecordatorioItem item={old} userId={USER} locale="es" />)
    expect(screen.getByTestId('recordatorio-completar')).toBeInTheDocument()
    expect(screen.queryByTestId('recordatorio-anular')).not.toBeInTheDocument()
  })

  it('no emisor: oculta anular', () => {
    render(<RecordatorioItem item={makeItem({ creado_por: 'otro' })} userId={USER} locale="es" />)
    expect(screen.queryByTestId('recordatorio-anular')).not.toBeInTheDocument()
  })

  it('completado: sin botones de acción', () => {
    const done = makeItem({
      completado_en: new Date().toISOString(),
      completado_por: USER,
    })
    render(<RecordatorioItem item={done} userId={USER} locale="es" />)
    expect(screen.queryByTestId('recordatorio-completar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recordatorio-anular')).not.toBeInTheDocument()
  })

  it('click en completar invoca completarRecordatorio con el id', async () => {
    completarMock.mockResolvedValue({ success: true, data: { recordatorio_id: 'rec-1' } })
    render(<RecordatorioItem item={makeItem()} userId={USER} locale="es" />)
    fireEvent.click(screen.getByTestId('recordatorio-completar'))
    await waitFor(() => expect(completarMock).toHaveBeenCalledWith({ recordatorio_id: 'rec-1' }))
  })
})
