import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProspectoListItem } from '../../queries/get-lista-espera'
import { ListaEsperaPanel } from '../ListaEsperaPanel'

/**
 * Censo C (B1, 2026-11-26): si el alta está hecha pero el prospecto no salió de la cola (`sigueEnCola`), la
 * pantalla lo dice además del éxito, en «Invitar» y en «Completar en Dirección»: un segundo alta crearía
 * otro niño. Sin el aviso, el éxito era lo único que se veía. Fixtures ficticios.
 */
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/es/admin/admisiones',
}))
const { toastWarning, toastSuccess, invitarMock, completarMock } = vi.hoisted(() => ({
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  invitarMock: vi.fn(),
  completarMock: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn(), warning: toastWarning },
}))
vi.mock('../../actions/invitar-al-alta', () => ({ invitarAlAlta: invitarMock }))
vi.mock('../../actions/completar-direccion', () => ({ completarEnDireccion: completarMock }))
vi.mock('../../actions/descartar-prospecto', () => ({ descartarProspecto: vi.fn() }))
vi.mock('../../actions/reordenar-lista-espera', () => ({ reordenarListaEspera: vi.fn() }))
vi.mock('../../actions/crear-prospecto', () => ({ crearProspecto: vi.fn() }))
vi.mock('../../actions/editar-prospecto', () => ({ editarProspecto: vi.fn() }))
vi.mock('../../actions/resolver-tutor', () => ({ resolverTutorParaProspecto: vi.fn() }))

const AULA = '44444444-4444-4444-8444-444444444444'
const AVISO = 'listaEspera.errors.sigue_en_cola'

const PROSPECTO: ProspectoListItem = {
  id: 'p-1',
  nombre_nino: 'Lucía',
  apellidos_nino: 'Demo',
  primer_apellido_nino: 'Demo',
  segundo_apellido_nino: null,
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
}

function pintar() {
  render(
    <ListaEsperaPanel
      cursos={[{ id: 'curso-1', nombre: '2026-27' }]}
      cursoSeleccionadoId="curso-1"
      prospectos={[PROSPECTO]}
      aulas={[{ aulaId: AULA, nombre: 'Aula 1-2', capacidad: 12, ocupacion: 3 }]}
      locale="es"
    />
  )
}

async function invitar() {
  pintar()
  fireEvent.click(screen.getByRole('button', { name: 'invitar' }))
  const [aula] = within(screen.getByRole('dialog')).getAllByRole('combobox')
  fireEvent.change(aula!, { target: { value: AULA } })
  fireEvent.click(screen.getByRole('button', { name: 'invitar_dialog.invitar' }))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
}

async function completar() {
  pintar()
  fireEvent.click(screen.getByRole('button', { name: 'completar' }))
  const d = within(screen.getByRole('dialog'))
  const [aula, parentesco] = d.getAllByRole('combobox')
  fireEvent.change(aula!, { target: { value: AULA } })
  fireEvent.change(d.getByLabelText('completar_dialog.nombre_label'), {
    target: { value: 'María' },
  })
  fireEvent.change(d.getByLabelText('completar_dialog.apellidos_label'), {
    target: { value: 'Tutora Demo' },
  })
  fireEvent.change(d.getByLabelText('completar_dialog.email_label'), {
    target: { value: 'tutor@nido.test' },
  })
  fireEvent.change(parentesco!, { target: { value: 'madre' } })
  const crear = screen.getByRole('button', { name: 'completar_dialog.crear' })
  expect(crear, 'premisa: el formulario está listo').toBeEnabled()
  fireEvent.click(crear)
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  toastWarning.mockClear()
  toastSuccess.mockClear()
  invitarMock.mockReset()
  completarMock.mockReset()
})

describe('ListaEsperaPanel: el alta hecha con el prospecto aún en la cola', () => {
  const casos = [
    ['invitar', 'ok', invitar, invitarMock, { invitationId: 'inv-1' }],
    ['invitar', 'vinculado', invitar, invitarMock, {}],
    ['completar', 'ok', completar, completarMock, { usuarioId: 'u-1' }],
    ['completar', 'vinculado', completar, completarMock, { usuarioId: 'u-1' }],
  ] as const

  it.each(casos)(
    'premisa: %s (%s) sin el aviso no avisa',
    async (_q, resultado, hacer, mock, extra) => {
      mock.mockResolvedValue({ success: true, data: { resultado, ninoId: 'n-1', ...extra } })
      await hacer()
      expect(toastWarning).not.toHaveBeenCalled()
    }
  )

  it.each(casos)(
    '%s (%s) con sigueEnCola: avisa además del éxito',
    async (_q, resultado, hacer, mock, extra) => {
      mock.mockResolvedValue({
        success: true,
        data: { resultado, ninoId: 'n-1', ...extra, sigueEnCola: true },
      })
      await hacer()
      expect(toastWarning).toHaveBeenCalledWith(AVISO)
    }
  )
})
