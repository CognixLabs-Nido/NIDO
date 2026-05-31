import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { destinosParaRol } from '../../lib/form-helpers'

vi.mock('../../actions/crear-recordatorio', () => ({ crearRecordatorio: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RecordatorioFormDialog } from '../RecordatorioFormDialog'

/**
 * Smoke del form. El contenido (Select base-ui de destino/niño + datetime-local)
 * no se conduce de forma fiable en jsdom — el dropdown base-ui no abre y
 * Select.Value no renderiza el label sin navegador real (ver docs/dev-setup.md
 * y PR #40). Por eso aquí solo verificamos que el componente monta con los
 * destinos reales de cada rol (hotfix #44: solo admin/profe usan el módulo); la
 * lógica de creación está cubierta por:
 *   - `crearRecordatorioCore` (tests unit de F6-A),
 *   - `destinosParaRol` / `requiereNino` / `datetimeLocalAIso` (form-helpers.test),
 *   - checklist visual en el PR.
 */
describe('RecordatorioFormDialog (smoke)', () => {
  const ninos = [{ id: 'n1', nombre: 'Demo', apellidos: 'Uno' }]

  it('monta con los destinos de admin (familia/personal)', () => {
    render(<RecordatorioFormDialog locale="es" destinos={destinosParaRol('admin')} ninos={ninos} />)
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })

  it('monta con los destinos de profe (familia/personal)', () => {
    render(<RecordatorioFormDialog locale="es" destinos={destinosParaRol('profe')} ninos={ninos} />)
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })

  it('monta con destino sin niño (personal) y lista de niños vacía', () => {
    render(<RecordatorioFormDialog locale="es" destinos={['personal']} ninos={[]} />)
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })
})
