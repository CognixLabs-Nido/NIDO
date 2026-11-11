import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Paso del menor — el mensaje después de guardar dice qué fue a la cola de Dirección y qué se
 * guardó ya (puerta de identidad, 2026-11-08): identidad, domicilio, las dos cosas, o guardado.
 * Nunca «guardado» de algo que espera a que Dirección lo apruebe.
 *
 * Los hijos pesados se sustituyen por stubs, como en `PasoMenor.imagen.test.tsx`: aquí solo se
 * prueba el mensaje que sale al guardar los datos del menor.
 */
const m = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  actualizarNinoTutor: vi.fn(),
  actualizarNinoFamilia: vi.fn(),
}))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: m.toastSuccess, error: m.toastError } }))
vi.mock('@/features/autorizaciones/actions/crear-imagen', () => ({
  crearImagenAutorizacion: vi.fn(),
}))
vi.mock('@/features/datos-pedagogicos/actions/upsert-datos-pedagogicos', () => ({
  upsertDatosPedagogicos: vi.fn(),
}))
vi.mock('@/features/ninos/actions/actualizar-nino-tutor', () => ({
  actualizarNinoTutor: m.actualizarNinoTutor,
}))
vi.mock('../../actions/actualizar-nino-familia', () => ({
  actualizarNinoFamilia: m.actualizarNinoFamilia,
}))
vi.mock('@/features/autorizaciones/components/FirmarAutorizacionPanel', () => ({
  FirmarAutorizacionPanel: () => <div />,
}))
vi.mock('@/features/datos-pedagogicos/components/DatosPedagogicosForm', () => ({
  DatosPedagogicosForm: () => <div />,
}))
vi.mock('@/features/ninos/components/SubirFotoNino', () => ({ SubirFotoNino: () => <div /> }))
vi.mock('../SubirDocumentoPdf', () => ({ SubirDocumentoPdf: () => <div /> }))
vi.mock('../AcuseAltaCheckbox', () => ({ AcuseAltaCheckbox: () => <div /> }))

import { PasoMenor } from '../PasoMenor'

const NINO = '22222222-2222-4222-8222-222222222222'

function renderPaso() {
  return render(
    <PasoMenor
      locale="es"
      ninoId={NINO}
      ninoNombre="Niño Demo 1"
      identidadInicial={{
        primer_apellido: 'Demo',
        segundo_apellido: null,
        fecha_nacimiento: '2024-03-15',
        sexo: null,
        nacionalidad: 'española',
        idioma_principal: 'es',
        lugar_nacimiento: 'Valencia',
        dni: null,
        hermanos_total: 1,
        hermanos_lugar: 1,
        direccion_provincia: null,
        observaciones_familia: null,
        como_nos_conocio: null,
        como_nos_conocio_otro: null,
      }}
      direccionInicial={{
        direccion_calle: 'Mayor',
        direccion_numero: '1',
        direccion_cp: '46001',
        direccion_ciudad: 'Valencia',
      }}
      datosPedagogicosInicial={null}
      libroFamiliaUrl={null}
      fotoInicialUrl={null}
      imagenPanel={null}
      imagenSinPlantilla={false}
      imagenAceptado={false}
      currentUserId="11111111-1111-4111-8111-111111111111"
      currentUserNombre="Tutor Pruebas"
      onDireccionChange={vi.fn()}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />
  )
}

/** Guarda con lo que contesta cada acción y devuelve el mensaje que salió. */
async function guardarCon(identidadEnCola: boolean, domicilioEnCola: boolean) {
  m.actualizarNinoTutor.mockResolvedValue({
    success: true,
    data: { id: NINO, pendienteValidacion: identidadEnCola },
  })
  m.actualizarNinoFamilia.mockResolvedValue({
    success: true,
    data: domicilioEnCola ? { pendienteValidacion: true } : { id: NINO },
  })
  renderPaso()
  fireEvent.click(screen.getByText('menor.guardar_datos'))
  await waitFor(() => expect(m.toastSuccess).toHaveBeenCalledTimes(1))
  // Premisa: el formulario pasó la validación y las dos acciones contestaron lo que se monta aquí.
  expect(m.actualizarNinoTutor).toHaveBeenCalledTimes(1)
  expect(m.actualizarNinoFamilia).toHaveBeenCalledTimes(1)
  expect(m.toastError).not.toHaveBeenCalled()
  return m.toastSuccess.mock.calls[0]![0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PasoMenor — el mensaje al guardar dice qué va a la cola', () => {
  it('identidad y domicilio a la cola', async () => {
    expect(await guardarCon(true, true)).toBe('validacion.enviado_identidad_domicilio')
  })

  it('solo la identidad a la cola', async () => {
    expect(await guardarCon(true, false)).toBe('validacion.enviado_identidad')
  })

  it('solo el domicilio a la cola', async () => {
    expect(await guardarCon(false, true)).toBe('validacion.enviado_domicilio')
  })

  it('nada a la cola: guardado', async () => {
    expect(await guardarCon(false, false)).toBe('identidad.guardado')
  })
})
