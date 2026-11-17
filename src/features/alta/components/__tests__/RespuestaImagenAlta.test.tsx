import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const otorgar = vi.fn()
const denegar = vi.fn()
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../actions/otorgar-imagen-alta', () => ({
  otorgarConsentimientoImagenAlta: (...a: unknown[]) => otorgar(...a),
}))
vi.mock('../../actions/denegar-imagen-alta', () => ({
  denegarConsentimientoImagenAlta: (...a: unknown[]) => denegar(...a),
}))

import { RespuestaImagenAlta } from '../RespuestaImagenAlta'

const NINO = '22222222-2222-4222-8222-222222222222'

/**
 * La pregunta de la imagen del alta (fase 10, 10a-2): «la base exige una RESPUESTA, no un «sí»»
 * (decisión del responsable del 2026-11-17). Dos respuestas, y cada una por su acción.
 */
describe('RespuestaImagenAlta', () => {
  beforeEach(() => {
    otorgar.mockReset().mockResolvedValue({ success: true, data: { ok: true } })
    denegar.mockReset().mockResolvedValue({ success: true, data: { ok: true } })
  })

  it('sin respuesta: las dos opciones y el aviso de que el «no» no frena', () => {
    render(<RespuestaImagenAlta ninoId={NINO} respuestaInicial={null} />)
    expect(screen.getByTestId('alta-imagen-autorizo')).toBeInTheDocument()
    expect(screen.getByTestId('alta-imagen-no-autorizo')).toBeInTheDocument()
    expect(screen.getByText('acuses.imagen_libre')).toBeInTheDocument()
  })

  it('«No autorizo» llama a denegar, no a otorgar, y avisa al padre', async () => {
    const onRespondido = vi.fn()
    render(
      <RespuestaImagenAlta ninoId={NINO} respuestaInicial={null} onRespondido={onRespondido} />
    )
    fireEvent.click(screen.getByTestId('alta-imagen-no-autorizo'))
    await waitFor(() => expect(screen.getByTestId('alta-imagen-no')).toBeInTheDocument())
    expect(denegar).toHaveBeenCalledWith({ nino_id: NINO })
    expect(otorgar).not.toHaveBeenCalled()
    expect(onRespondido).toHaveBeenCalledTimes(1)
    // Se puede cambiar: queda el «sí» y no el «no» repetido.
    expect(screen.getByTestId('alta-imagen-autorizo')).toBeInTheDocument()
    expect(screen.queryByTestId('alta-imagen-no-autorizo')).not.toBeInTheDocument()
  })

  it('con el «sí» ya dado, se ofrece cambiar a «no»', () => {
    render(<RespuestaImagenAlta ninoId={NINO} respuestaInicial="si" />)
    expect(screen.getByTestId('alta-imagen-si')).toBeInTheDocument()
    expect(screen.getByTestId('alta-imagen-no-autorizo')).toBeInTheDocument()
    expect(screen.queryByTestId('alta-imagen-autorizo')).not.toBeInTheDocument()
  })

  it('alta en papel (soloSi): solo el «sí», sin el aviso del «no»', () => {
    render(<RespuestaImagenAlta ninoId={NINO} respuestaInicial={null} soloSi />)
    expect(screen.getByTestId('alta-imagen-autorizo')).toBeInTheDocument()
    expect(screen.queryByTestId('alta-imagen-no-autorizo')).not.toBeInTheDocument()
    expect(screen.queryByText('acuses.imagen_libre')).not.toBeInTheDocument()
  })
})
