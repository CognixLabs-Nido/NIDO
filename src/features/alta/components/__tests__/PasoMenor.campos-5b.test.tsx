import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IdentidadInicial } from '../../lib/tipos'

/**
 * Paso del menor, fase 5b (decisiones del responsable del 2026-11-10): lugar de nacimiento,
 * nacionalidad y hermanos obligatorios; las observaciones con el aviso de que lo médico va en la
 * ficha médica; «cómo nos has conocido» solo a familias nuevas en el centro (lo decide la página y
 * llega como `mostrarComoNosConocio`), y sin la pregunta en pantalla no se manda nada (NULL = dejar
 * lo guardado).
 */
const m = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  actualizarNinoTutor: vi.fn(),
  actualizarNinoFamilia: vi.fn(),
}))

// `has`: el mensaje de error de un campo (`FormMessage`) pregunta si la clave existe.
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: () => true }),
}))
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

function renderPaso(over: Partial<IdentidadInicial> = {}, mostrarComo = false) {
  return render(
    <PasoMenor
      locale="es"
      ninoId={NINO}
      ninoNombre="Niño Demo 1"
      mostrarComoNosConocio={mostrarComo}
      identidadInicial={{
        primer_apellido: 'Demo',
        segundo_apellido: null,
        fecha_nacimiento: '2024-03-15',
        sexo: null,
        nacionalidad: 'española',
        idioma_principal: 'es',
        lugar_nacimiento: 'Valencia',
        dni: null,
        sip: '12345678',
        hermanos_total: 1,
        hermanos_lugar: 1,
        direccion_provincia: null,
        observaciones_familia: null,
        como_nos_conocio: null,
        como_nos_conocio_otro: null,
        ...over,
      }}
      direccionInicial={{
        direccion_calle: 'Mayor',
        direccion_numero: '1',
        direccion_cp: '46001',
        direccion_ciudad: 'Valencia',
      }}
      datosPedagogicosInicial={null}
      datosPedagogicosLeidos
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

async function guardar() {
  m.actualizarNinoTutor.mockResolvedValue({
    success: true,
    data: { id: NINO, pendienteValidacion: false },
  })
  m.actualizarNinoFamilia.mockResolvedValue({ success: true, data: { id: NINO } })
  fireEvent.click(screen.getByText('menor.guardar_datos'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PasoMenor — los campos de la fase 5', () => {
  it('familia que ya tiene otro niño en el centro: no se pregunta, y no se manda nada', async () => {
    renderPaso({}, false)
    expect(screen.queryByTestId('pregunta-como-nos-conocio')).toBeNull()
    await guardar()
    await waitFor(() => expect(m.actualizarNinoTutor).toHaveBeenCalledTimes(1))
    expect(m.toastError).not.toHaveBeenCalled() // premisa: el formulario pasó la validación
    expect(m.actualizarNinoTutor.mock.calls[0]![0]).toMatchObject({
      como_nos_conocio: null,
      como_nos_conocio_otro: null,
      lugar_nacimiento: 'Valencia',
      hermanos_total: 1,
      hermanos_lugar: 1,
      sip: '12345678',
    })
  })

  it('familia nueva: se pregunta, y lo que se contestó viaja', async () => {
    renderPaso({ como_nos_conocio: 'recomendacion' }, true)
    expect(screen.getByTestId('pregunta-como-nos-conocio')).toBeTruthy()
    await guardar()
    await waitFor(() => expect(m.actualizarNinoTutor).toHaveBeenCalledTimes(1))
    expect(m.actualizarNinoTutor.mock.calls[0]![0]).toMatchObject({
      como_nos_conocio: 'recomendacion',
    })
  })

  it('las observaciones llevan el aviso de que lo médico va en la ficha médica', () => {
    renderPaso()
    expect(screen.getByTestId('aviso-observaciones-medico').textContent).toBe(
      'menor.observaciones_aviso'
    )
  })

  it('sin lugar de nacimiento, nacionalidad, hermanos o tarjeta sanitaria, no se guarda nada', async () => {
    const casos: [Partial<IdentidadInicial>, string][] = [
      [{ lugar_nacimiento: null }, 'nino.validation.lugar_requerido'],
      [{ nacionalidad: null }, 'nino.validation.nacionalidad_requerida'],
      [{ hermanos_total: null, hermanos_lugar: null }, 'nino.validation.hermanos_requeridos'],
      // Fase 7: la tarjeta sanitaria, obligatoria; y con una forma que no es de ninguna tarjeta.
      [{ sip: null }, 'nino.validation.sip_requerido'],
      [{ sip: 'M-12' }, 'nino.validation.sip_invalido'],
    ]
    for (const [falta, mensaje] of casos) {
      cleanup()
      vi.clearAllMocks()
      renderPaso(falta)
      await guardar()
      // El formulario lo para con el mensaje de ESE campo, y ninguna acción se llama.
      expect.soft((await screen.findAllByText(mensaje)).length, mensaje).toBeGreaterThan(0)
      expect.soft(m.actualizarNinoTutor, mensaje).not.toHaveBeenCalled()
    }
  })
})
