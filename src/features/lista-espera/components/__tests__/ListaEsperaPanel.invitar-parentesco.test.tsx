import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProspectoListItem } from '../../queries/get-lista-espera'
import { ListaEsperaPanel } from '../ListaEsperaPanel'

/**
 * Hueco 1 (alta del 2.º hijo, opción A) — el diálogo "Invitar" pide el parentesco SOLO cuando
 * el tutor no tiene vínculo del que heredarlo (`necesita_parentesco`), y lo REVELA si la acción
 * contesta `parentesco_requerido` (cuenta detectada al promover), en vez de dejar un callejón.
 *
 * Los `<select>` del diálogo son nativos → se conducen con `fireEvent.change`.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/es/admin/admisiones',
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

const invitarMock = vi.fn()
vi.mock('../../actions/invitar-al-alta', () => ({
  invitarAlAlta: (...a: unknown[]) => invitarMock(...a),
}))
vi.mock('../../actions/completar-direccion', () => ({ completarEnDireccion: vi.fn() }))
vi.mock('../../actions/descartar-prospecto', () => ({ descartarProspecto: vi.fn() }))
vi.mock('../../actions/reordenar-lista-espera', () => ({ reordenarListaEspera: vi.fn() }))
vi.mock('../../actions/crear-prospecto', () => ({ crearProspecto: vi.fn() }))
vi.mock('../../actions/editar-prospecto', () => ({ editarProspecto: vi.fn() }))
vi.mock('../../actions/resolver-tutor', () => ({ resolverTutorParaProspecto: vi.fn() }))

const AULA = '44444444-4444-4444-8444-444444444444'
const PARENTESCO_REQUERIDO = 'admin.admisiones.anadirHijo.errors.parentesco_requerido'

function prospecto(over: Partial<ProspectoListItem> = {}): ProspectoListItem {
  return {
    id: 'p-1',
    nombre_nino: 'Lucía',
    apellidos_nino: 'Demo',
    fecha_nacimiento: '2024-01-01',
    telefono_tutor: null,
    email_tutor: 'tutor@nido.test',
    nota: null,
    posicion: 1,
    estado: 'en_espera',
    tutor_usuario_id: null,
    nino_id: null,
    estado_matricula: null,
    necesita_parentesco: false,
    ...over,
  }
}

function abrirInvitar(p: ProspectoListItem) {
  render(
    <ListaEsperaPanel
      cursos={[{ id: 'curso-1', nombre: '2026-27' }]}
      cursoSeleccionadoId="curso-1"
      prospectos={[p]}
      aulas={[{ aulaId: AULA, nombre: 'Aula 1-2', capacidad: 12, ocupacion: 3 }]}
      locale="es"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'invitar' }))
}

/** Selects del diálogo abierto (no el de curso del panel): [0] = aula, [1] = parentesco. */
function selects() {
  return within(screen.getByRole('dialog')).getAllByRole('combobox')
}
function botonInvitar() {
  return screen.getByRole('button', { name: 'invitar_dialog.invitar' })
}

beforeEach(() => {
  invitarMock.mockReset()
  toastSuccess.mockClear()
  toastError.mockClear()
})

describe('ListaEsperaPanel · Invitar pide el parentesco (hueco 1)', () => {
  it('tutor con vínculo del que heredar (sin flag) → NO pide parentesco; envía solo aula', async () => {
    invitarMock.mockResolvedValue({ success: true, data: { resultado: 'vinculado', ninoId: 'n' } })
    abrirInvitar(prospecto({ tutor_usuario_id: 'tutor-uid', necesita_parentesco: false }))

    // Ancla positiva: el diálogo está abierto (el selector de aula está).
    expect(screen.getByText('invitar_dialog.aula_label')).toBeInTheDocument()
    expect(selects()).toHaveLength(1)
    expect(screen.queryByText('completar_dialog.parentesco_label')).not.toBeInTheDocument()

    fireEvent.change(selects()[0]!, { target: { value: AULA } })
    expect(botonInvitar()).toBeEnabled()
    fireEvent.click(botonInvitar())

    await waitFor(() => expect(invitarMock).toHaveBeenCalledTimes(1))
    expect(invitarMock.mock.calls[0]?.[0]).toEqual({ id: 'p-1', aulaId: AULA })
  })

  it('flag necesita_parentesco → pide parentesco; sin él no deja invitar; con él lo envía', async () => {
    invitarMock.mockResolvedValue({ success: true, data: { resultado: 'vinculado', ninoId: 'n' } })
    abrirInvitar(prospecto({ tutor_usuario_id: 'tutor-uid', necesita_parentesco: true }))

    expect(screen.getByText('completar_dialog.parentesco_label')).toBeInTheDocument()
    expect(selects()).toHaveLength(2)

    fireEvent.change(selects()[0]!, { target: { value: AULA } })
    expect(botonInvitar()).toBeDisabled()

    fireEvent.change(selects()[1]!, { target: { value: 'otro' } })
    // 'otro' exige descripción.
    expect(screen.getByText('completar_dialog.descripcion_label')).toBeInTheDocument()
    expect(botonInvitar()).toBeDisabled()
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), {
      target: { value: 'Tutora legal' },
    })
    expect(botonInvitar()).toBeEnabled()

    fireEvent.click(botonInvitar())
    await waitFor(() => expect(invitarMock).toHaveBeenCalledTimes(1))
    expect(invitarMock.mock.calls[0]?.[0]).toEqual({
      id: 'p-1',
      aulaId: AULA,
      parentesco: 'otro',
      descripcionParentesco: 'Tutora legal',
    })
  })

  it('la acción contesta parentesco_requerido → revela el campo y permite reenviar con él', async () => {
    invitarMock
      .mockResolvedValueOnce({ success: false, error: PARENTESCO_REQUERIDO })
      .mockResolvedValueOnce({ success: true, data: { resultado: 'vinculado', ninoId: 'n' } })
    abrirInvitar(prospecto({ necesita_parentesco: false }))

    expect(selects()).toHaveLength(1)
    fireEvent.change(selects()[0]!, { target: { value: AULA } })
    fireEvent.click(botonInvitar())

    // Revelado: aparece el selector de parentesco y el aviso específico (no el error crudo).
    await waitFor(() =>
      expect(screen.getByText('completar_dialog.parentesco_label')).toBeInTheDocument()
    )
    expect(toastError).toHaveBeenCalledWith('invitar_dialog.parentesco_revelado')
    expect(botonInvitar()).toBeDisabled()

    fireEvent.change(selects()[1]!, { target: { value: 'abuela' } })
    fireEvent.click(botonInvitar())

    await waitFor(() => expect(invitarMock).toHaveBeenCalledTimes(2))
    expect(invitarMock.mock.calls[1]?.[0]).toEqual({
      id: 'p-1',
      aulaId: AULA,
      parentesco: 'abuela',
      descripcionParentesco: null,
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('vinculado_invitar'))
  })

  it('otros errores siguen saliendo como toast traducido, sin revelar el campo', async () => {
    invitarMock.mockResolvedValue({ success: false, error: 'listaEspera.errors.alta_fallo' })
    abrirInvitar(prospecto())

    fireEvent.change(selects()[0]!, { target: { value: AULA } })
    fireEvent.click(botonInvitar())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('listaEspera.errors.alta_fallo'))
    expect(screen.queryByText('completar_dialog.parentesco_label')).not.toBeInTheDocument()
    expect(selects()).toHaveLength(1)
  })
})
