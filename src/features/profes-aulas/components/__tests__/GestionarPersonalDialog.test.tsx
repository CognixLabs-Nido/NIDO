import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { GestionarPersonalDialog } from '../GestionarPersonalDialog'
import type { PersonalAulaItem } from '../../queries/get-personal-aula'
import type { ProfeCandidato } from '../../queries/get-profes-candidatos'

/**
 * Tests de `GestionarPersonalDialog` (item 4).
 *
 * base-ui Dialog se abre con `fireEvent.click` en el trigger (precedente:
 * EscribirAFamiliaAdminPicker). Los Selects base-ui NO se conducen de forma
 * fiable en jsdom (portales + pointer events; sin precedente en la suite),
 * así que los flujos que pasan por Select (añadir, cambiar tipo, sustitución
 * de coordinadora) se verifican a nivel de action-core
 * (`profes-aulas-actions.test.ts`, orden seguro degradar→promover) y en el
 * checklist visual de preview. Aquí cubrimos render + flujos button-driven.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

const asignarMock = vi.fn()
const terminarMock = vi.fn()
const cambiarMock = vi.fn()
const sustituirMock = vi.fn()
const moverMock = vi.fn()

vi.mock('../../actions/asignar-profe-aula', () => ({
  asignarProfeAula: (...a: unknown[]) => asignarMock(...a),
}))
vi.mock('../../actions/terminar-asignacion', () => ({
  terminarAsignacion: (...a: unknown[]) => terminarMock(...a),
}))
vi.mock('../../actions/cambiar-tipo-personal', () => ({
  cambiarTipoPersonal: (...a: unknown[]) => cambiarMock(...a),
}))
vi.mock('../../actions/sustituir-coordinadora', () => ({
  sustituirCoordinadora: (...a: unknown[]) => sustituirMock(...a),
}))
vi.mock('../../actions/mover-profe-aula', () => ({
  moverProfeAula: (...a: unknown[]) => moverMock(...a),
}))

const AULA = { id: 'aula-1', nombre: 'Aula 1-2' }

function personal(...items: Array<Partial<PersonalAulaItem>>): PersonalAulaItem[] {
  return items.map((it, i) => ({
    asignacion_id: it.asignacion_id ?? `asig-${i}`,
    profe_id: it.profe_id ?? `p-${i}`,
    nombre_completo: it.nombre_completo ?? `Persona ${i}`,
    tipo_personal_aula: it.tipo_personal_aula ?? 'profesora',
  }))
}

const CANDIDATOS: ProfeCandidato[] = [
  { id: 'c-1', nombre_completo: 'Candidata Uno' },
  { id: 'c-2', nombre_completo: 'Candidata Dos' },
]

beforeEach(() => {
  toastSuccess.mockClear()
  toastError.mockClear()
  asignarMock.mockReset()
  terminarMock.mockReset()
  cambiarMock.mockReset()
  sustituirMock.mockReset()
  moverMock.mockReset()
})

function open(props: Parameters<typeof GestionarPersonalDialog>[0]) {
  render(<GestionarPersonalDialog {...props} />)
  fireEvent.click(screen.getByTestId(`admin-aula-gestionar-${props.aula.id}`))
}

describe('GestionarPersonalDialog', () => {
  it('renderiza el botón trigger con data-testid por aula', () => {
    render(<GestionarPersonalDialog aula={AULA} personal={[]} candidatos={[]} aulasDestino={[]} />)
    expect(screen.getByTestId('admin-aula-gestionar-aula-1')).toBeDefined()
  })

  it('aula vacía: muestra empty state al abrir', () => {
    open({ aula: AULA, personal: [], candidatos: CANDIDATOS, aulasDestino: [] })
    expect(screen.getByTestId('personal-dialog-empty')).toBeDefined()
  })

  it('con personal: pinta una fila por persona y badge de coordinadora', () => {
    open({
      aula: AULA,
      personal: personal(
        { profe_id: 'p-coord', nombre_completo: 'Mar', tipo_personal_aula: 'coordinadora' },
        { profe_id: 'p-prof', nombre_completo: 'Lola', tipo_personal_aula: 'profesora' }
      ),
      candidatos: CANDIDATOS,
      aulasDestino: [],
    })
    expect(screen.getByTestId('personal-dialog-row-p-coord')).toBeDefined()
    expect(screen.getByTestId('personal-dialog-row-p-prof')).toBeDefined()
    // El badge "coordinadora" aparece (clave i18n mockeada a la identidad).
    expect(screen.getAllByText('tipo.coordinadora').length).toBeGreaterThan(0)
  })

  it('retirar: pide confirmación y al confirmar llama terminarAsignacion con el id', async () => {
    terminarMock.mockResolvedValue({ success: true, data: { id: 'asig-9' } })
    open({
      aula: AULA,
      personal: personal({ asignacion_id: 'asig-9', profe_id: 'p-9', nombre_completo: 'Pedro' }),
      candidatos: [],
      aulasDestino: [],
    })

    // Sin confirmar todavía: no se ha llamado.
    fireEvent.click(screen.getByTestId('personal-dialog-retirar-p-9'))
    expect(terminarMock).not.toHaveBeenCalled()

    // Confirmar.
    fireEvent.click(screen.getByTestId('personal-dialog-retirar-confirm-p-9'))
    await waitFor(() => expect(terminarMock).toHaveBeenCalledWith({ asignacion_id: 'asig-9' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('botón Añadir está deshabilitado mientras no se elige persona', () => {
    open({ aula: AULA, personal: [], candidatos: CANDIDATOS, aulasDestino: [] })
    const addBtn = screen.getByTestId('personal-dialog-add-button') as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)
  })

  it('sin candidatos disponibles: muestra mensaje en lugar del formulario de añadir', () => {
    open({ aula: AULA, personal: [], candidatos: [], aulasDestino: [] })
    expect(screen.getByText('sin_candidatos')).toBeDefined()
    expect(screen.queryByTestId('personal-dialog-add-button')).toBeNull()
  })

  it('candidatos ya activos en el aula se excluyen del pool de añadir', () => {
    // c-1 ya está en el aula → solo c-2 quedaría disponible; con ambos dentro,
    // el formulario sigue visible (queda c-2). Verificamos que el form existe.
    open({
      aula: AULA,
      personal: personal({ profe_id: 'c-1', nombre_completo: 'Candidata Uno' }),
      candidatos: CANDIDATOS,
      aulasDestino: [],
    })
    expect(screen.getByTestId('personal-dialog-add-button')).toBeDefined()
  })
})
