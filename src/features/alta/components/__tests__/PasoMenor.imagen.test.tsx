import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Paso del menor del alta — la sección «Autorización de imagen» solo la ve quien puede dar
 * el consentimiento (tutor legal o modo Dirección). A un vínculo `autorizado` se le oculta
 * entera (documento, «Cargar documento» y casilla) y se le explica por qué.
 *
 * Los hijos pesados (formularios, subida de foto, panel de firma) se sustituyen por stubs:
 * aquí solo se prueba qué se pinta en la sección de imagen.
 */
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/autorizaciones/actions/crear-imagen', () => ({
  crearImagenAutorizacion: vi.fn(),
}))
vi.mock('@/features/datos-pedagogicos/actions/upsert-datos-pedagogicos', () => ({
  upsertDatosPedagogicos: vi.fn(),
}))
vi.mock('@/features/ninos/actions/actualizar-nino-tutor', () => ({
  actualizarNinoTutor: vi.fn(),
}))
vi.mock('../../actions/actualizar-nino-familia', () => ({ actualizarNinoFamilia: vi.fn() }))
vi.mock('@/features/autorizaciones/components/FirmarAutorizacionPanel', () => ({
  FirmarAutorizacionPanel: () => <div data-testid="stub-panel-firma-imagen" />,
}))
vi.mock('@/features/datos-pedagogicos/components/DatosPedagogicosForm', () => ({
  DatosPedagogicosForm: () => <div />,
}))
vi.mock('@/features/ninos/components/SubirFotoNino', () => ({
  SubirFotoNino: ({ motivoBloqueo }: { motivoBloqueo?: string }) => (
    <div data-testid="stub-subir-foto">{motivoBloqueo}</div>
  ),
}))
vi.mock('../SubirDocumentoPdf', () => ({ SubirDocumentoPdf: () => <div /> }))
vi.mock('../AcuseAltaCheckbox', () => ({
  AcuseAltaCheckbox: ({ tipo }: { tipo: string }) => <div data-testid={`stub-casilla-${tipo}`} />,
}))

import { PasoMenor } from '../PasoMenor'

const NINO = '22222222-2222-4222-8222-222222222222'

function renderPaso(props: {
  puedeConsentirImagen?: boolean
  imagenPanel?: { autorizacionId: string; firmable: boolean; roster: [] } | null
}) {
  return render(
    <PasoMenor
      locale="es"
      ninoId={NINO}
      ninoNombre="Niño Demo 1"
      identidadInicial={{
        apellidos: 'Demo',
        fecha_nacimiento: '2024-03-15',
        sexo: null,
        nacionalidad: null,
        idioma_principal: 'es',
      }}
      direccionInicial={{
        direccion_calle: null,
        direccion_numero: null,
        direccion_cp: null,
        direccion_ciudad: null,
      }}
      datosPedagogicosInicial={null}
      libroFamiliaUrl={null}
      fotoInicialUrl={null}
      imagenPanel={props.imagenPanel ?? null}
      imagenSinPlantilla={false}
      imagenAceptado={false}
      puedeConsentirImagen={props.puedeConsentirImagen}
      currentUserId="11111111-1111-4111-8111-111111111111"
      currentUserNombre="Tutor Pruebas"
      onDireccionChange={vi.fn()}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />
  )
}

describe('PasoMenor — sección de autorización de imagen', () => {
  it('tutor legal (por defecto): casilla y «Cargar documento» visibles, sin el aviso', () => {
    renderPaso({})
    const seccion = screen.getByTestId('alta-imagen-autorizacion')
    expect(seccion).toBeInTheDocument()
    expect(screen.getByTestId('stub-casilla-imagen')).toBeInTheDocument()
    expect(screen.getByText('imagen.cargar')).toBeInTheDocument()
    expect(screen.queryByTestId('alta-imagen-solo-tutor-legal')).not.toBeInTheDocument()
  })

  it('tutor legal con documento instanciado: se pinta el panel de firma', () => {
    renderPaso({ imagenPanel: { autorizacionId: 'a1', firmable: true, roster: [] } })
    expect(screen.getByTestId('stub-panel-firma-imagen')).toBeInTheDocument()
    expect(screen.getByTestId('stub-casilla-imagen')).toBeInTheDocument()
  })

  it('autorizado: se oculta la sección entera y se explica que la da el tutor legal', () => {
    renderPaso({
      puedeConsentirImagen: false,
      imagenPanel: { autorizacionId: 'a1', firmable: true, roster: [] },
    })
    // Ancla positiva: la sección existe y muestra el aviso…
    expect(screen.getByTestId('alta-imagen-solo-tutor-legal')).toHaveTextContent(
      'imagen.solo_tutor_legal'
    )
    // …y ninguna de las tres vías para consentir.
    expect(screen.queryByTestId('stub-casilla-imagen')).not.toBeInTheDocument()
    expect(screen.queryByTestId('stub-panel-firma-imagen')).not.toBeInTheDocument()
    expect(screen.queryByText('imagen.cargar')).not.toBeInTheDocument()
    // El aviso de la foto no le pide algo que no puede hacer.
    expect(screen.getByTestId('stub-subir-foto')).toHaveTextContent('imagen.solo_tutor_legal')
  })
})
