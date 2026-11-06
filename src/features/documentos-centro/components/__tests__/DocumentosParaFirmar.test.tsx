import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Los documentos del centro para firmar (fase 4: el alta, 4b-1, y la ficha, 4c). Lo que se pinta por estado y, sobre todo, que
 * el botón de firmar sale DESPUÉS de abrir el PDF (decisión del 2026-11-06): antes de abrirlo no hay
 * botón, y al abrirlo aparece. El texto no dice «he leído».
 */
const firmar = vi.fn()
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, v?: Record<string, string>) =>
    v ? `${key}:${Object.values(v).join('|')}` : key,
  useFormatter: () => ({ dateTime: () => '5 de noviembre de 2026' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../actions/firmar', () => ({
  firmarDocumentoCentroAction: (i: unknown) => firmar(i),
}))
vi.mock('@/features/autorizaciones/components/FirmaPad', () => ({
  FirmaPad: ({ onChange }: { onChange: (v: string) => void }) => (
    <button type="button" data-testid="pad" onClick={() => onChange('data:image/png;base64,AAAA')}>
      pad
    </button>
  ),
}))

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { DocumentosParaFirmar, type DocumentoParaFirmarFila } from '../DocumentosParaFirmar'

const NINO = '22222222-2222-4222-8222-222222222222'
const VERSION = '33333333-3333-4333-8333-333333333333'

const fila = (o: Partial<DocumentoParaFirmarFila>): DocumentoParaFirmarFila => ({
  documento_id: '44444444-4444-4444-8444-444444444444',
  titulo: 'Normas',
  obligatorio: true,
  curso_academico_id: null,
  curso_nombre: null,
  estado: 'por_firmar',
  version_id: VERSION,
  firmado_at: null,
  metodo_firma: null,
  ...o,
})

const pinta = (documentos: DocumentoParaFirmarFila[], modoDireccion = false) =>
  render(
    <DocumentosParaFirmar
      locale="es"
      ninoId={NINO}
      documentos={documentos}
      modoDireccion={modoDireccion}
    />
  )

describe('DocumentosParaFirmar', () => {
  beforeEach(() => {
    firmar.mockReset()
    firmar.mockResolvedValue({ success: true, data: { firmaId: 'x' } })
  })

  it('premisa: con un documento por firmar se pinta su enlace al PDF de esa versión y de ese niño', () => {
    pinta([fila({})])
    const enlace = screen.getByRole('link', { name: /abrir/ })
    expect(enlace.getAttribute('href')).toBe(`/es/documento-centro/${NINO}/${VERSION}`)
    expect(enlace.getAttribute('target')).toBe('_blank')
  })

  it('el botón de firmar no está antes de abrir el documento, y sale al abrirlo', () => {
    pinta([fila({})])
    expect(screen.queryByRole('button', { name: /^firmar:/ })).toBeNull()
    expect(screen.getByText('antes_de_abrir')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /abrir/ }))
    expect(screen.getByRole('button', { name: 'firmar:Normas' })).toBeTruthy()
    expect(screen.getByText('abierto')).toBeTruthy()
  })

  it('ningún texto de la sección, en los tres idiomas, dice que se ha leído', () => {
    // Abrir no prueba haber leído (decisión del 2026-11-06). Se miran los textos de verdad: con las
    // traducciones simuladas la pantalla pinta claves, y este aserto pasaría por eso.
    for (const m of [es, en, va]) {
      const textos = JSON.stringify(m.firmar_documentos)
      expect(textos.length).toBeGreaterThan(200)
      expect(textos).not.toMatch(/le[ií]d[oa]|\bread\b|llegit|llegida/i)
    }
  })

  it('con el dedo: hace falta el nombre y el trazo, y la acción recibe los dos', async () => {
    pinta([fila({})])
    fireEvent.click(screen.getByRole('link', { name: /abrir/ }))
    const boton = screen.getByRole('button', { name: 'firmar:Normas' }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('nombre'), { target: { value: 'Madre Demo' } })
    expect(boton.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pad'))
    expect(boton.disabled).toBe(false)
    fireEvent.click(boton)
    await waitFor(() => expect(firmar).toHaveBeenCalledTimes(1))
    expect(firmar).toHaveBeenCalledWith({
      ninoId: NINO,
      versionId: VERSION,
      nombreTecleado: 'Madre Demo',
      firmaImagen: 'data:image/png;base64,AAAA',
    })
  })

  it('en el modo Dirección no hay trazo: el aviso del papel y el botón de registrar', async () => {
    pinta([fila({})], true)
    fireEvent.click(screen.getByRole('link', { name: /abrir/ }))
    expect(screen.queryByTestId('pad')).toBeNull()
    expect(screen.getByText('presencial_aviso:Normas')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('nombre'), { target: { value: 'Madre Demo' } })
    fireEvent.click(screen.getByRole('button', { name: 'firmar_presencial:Normas' }))
    await waitFor(() => expect(firmar).toHaveBeenCalledTimes(1))
    expect(firmar.mock.calls[0][0]).toMatchObject({ firmaImagen: null })
  })

  it('el que el centro no ha subido: se dice, y no hay enlace ni botón', () => {
    pinta([fila({ estado: 'falta_documento', version_id: null, titulo: 'Presupuesto' })])
    expect(screen.getByText('falta:Presupuesto')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('el firmado dice cuándo, y si fue en papel', () => {
    pinta([
      fila({ estado: 'firmado', firmado_at: '2026-11-05T10:00:00Z', metodo_firma: 'digital' }),
      fila({
        documento_id: '55555555-5555-4555-8555-555555555555',
        estado: 'firmado',
        firmado_at: '2026-11-05T10:00:00Z',
        metodo_firma: 'presencial',
      }),
    ])
    expect(screen.getByText('firmado:5 de noviembre de 2026')).toBeTruthy()
    expect(screen.getByText('firmado_papel:5 de noviembre de 2026')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('sin documentos no se pinta la sección', () => {
    const { container } = pinta([])
    expect(container.textContent).toBe('')
  })
})
