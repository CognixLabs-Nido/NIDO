import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { destinosParaRol } from '../../lib/form-helpers'

vi.mock('../../actions/crear-recordatorio', () => ({ crearRecordatorio: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { RecordatorioFormDialog } from '../RecordatorioFormDialog'

/**
 * Smoke del form. El contenido (Select base-ui de destino/niño/aula/profe +
 * datetime-local) no se conduce de forma fiable en jsdom — el dropdown base-ui
 * no abre y Select.Value no renderiza el label sin navegador real (ver
 * docs/dev-setup.md y PR #40). Por eso aquí solo verificamos que el componente
 * monta con los destinos reales de cada rol (F6-C: admin 6 destinos, profe 3);
 * la lógica está cubierta por:
 *   - `crearRecordatorioCore` (tests unit del core por los 6 destinos),
 *   - `destinosParaRol` / `requiereNino|Aula|Usuario` / `datetimeLocalAIso`
 *     (form-helpers.test),
 *   - checklist visual en el PR.
 */
describe('RecordatorioFormDialog (smoke)', () => {
  const ninos = [{ id: 'n1', nombre: 'Demo', apellidos: 'Uno' }]
  const aulas = [{ id: 'a1', nombre: 'Aula Roja' }]
  const profes = [{ id: 'p1', nombre: 'Profe Demo' }]

  it('monta con los 6 destinos de admin', () => {
    expect(destinosParaRol('admin')).toHaveLength(6)
    render(
      <RecordatorioFormDialog
        locale="es"
        destinos={destinosParaRol('admin')}
        ninos={ninos}
        aulas={aulas}
        profes={profes}
      />
    )
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })

  it('monta con los 3 destinos de profe (sin profe_individual/profes_centro)', () => {
    expect(destinosParaRol('profe')).toEqual(['familia_individual', 'familias_aula', 'personal'])
    render(
      <RecordatorioFormDialog
        locale="es"
        destinos={destinosParaRol('profe')}
        ninos={ninos}
        aulas={aulas}
        profes={[]}
      />
    )
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })

  it('monta con destino sin referencia (personal) y listas vacías', () => {
    render(
      <RecordatorioFormDialog
        locale="es"
        destinos={['personal']}
        ninos={[]}
        aulas={[]}
        profes={[]}
      />
    )
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })

  it('monta con preset contextual (F6-C-3: familia_individual + niño)', () => {
    // El dropdown base-ui no abre en jsdom; la preselección (preset → defaults)
    // se valida de forma determinista en form-helpers.test (recordatorioFormDefaults).
    render(
      <RecordatorioFormDialog
        locale="es"
        destinos={destinosParaRol('admin')}
        ninos={ninos}
        aulas={aulas}
        profes={profes}
        preset={{ destinatario: 'familia_individual', nino_id: 'n1' }}
      />
    )
    expect(screen.getByTestId('recordatorios-nuevo')).toBeInTheDocument()
  })
})
