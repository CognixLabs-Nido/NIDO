import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

import { RespuestaImagenAlta, RespuestaImagenPapel } from '../RespuestaImagenAlta'

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

  it('la familia contesta por sí misma: la acción no lleva tutor_id', async () => {
    render(<RespuestaImagenAlta ninoId={NINO} respuestaInicial={null} />)
    fireEvent.click(screen.getByTestId('alta-imagen-autorizo'))
    await waitFor(() => expect(screen.getByTestId('alta-imagen-si')).toBeInTheDocument())
    expect(otorgar).toHaveBeenCalledWith({ nino_id: NINO })
  })
})

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/**
 * El alta en papel (10b-2): Dirección anota lo que contestó cada tutor legal en el papel, a nombre
 * de ese tutor y no al suyo («No es un «no» de la directora: es el de la familia, anotado por ella»,
 * 2026-11-18). Sustituye al `soloSi`, que solo dejaba el «sí».
 */
describe('RespuestaImagenPapel', () => {
  beforeEach(() => {
    otorgar.mockReset().mockResolvedValue({ success: true, data: { ok: true } })
    denegar.mockReset().mockResolvedValue({ success: true, data: { ok: true } })
  })

  it('una fila por tutor legal con cuenta; el «no» de B va a nombre de B y solo cambia su fila', async () => {
    render(
      <RespuestaImagenPapel
        ninoId={NINO}
        tutores={[
          { usuarioId: A, nombre: 'Tutor A', respuesta: 'si' },
          { usuarioId: B, nombre: 'Tutor B', respuesta: null },
        ]}
      />
    )
    const filaA = screen.getByTestId(`alta-imagen-papel-${A}`)
    const filaB = screen.getByTestId(`alta-imagen-papel-${B}`)
    // Premisa: A ya dijo «sí» (solo se le ofrece el «no») y B no ha contestado.
    expect(within(filaA).getByText(/acuses\.imagen_aceptado/)).toBeInTheDocument()
    expect(within(filaA).queryByText('acuses.imagen_boton_si')).not.toBeInTheDocument()
    expect(within(filaB).getByText(/acuses\.imagen_papel_sin_respuesta/)).toBeInTheDocument()

    fireEvent.click(within(filaB).getByText('acuses.imagen_boton_no'))
    await waitFor(() =>
      expect(within(filaB).getByText(/acuses\.imagen_denegado/)).toBeInTheDocument()
    )
    expect(denegar).toHaveBeenCalledWith({ nino_id: NINO, tutor_id: B })
    expect(otorgar).not.toHaveBeenCalled()
    expect(within(filaA).getByText(/acuses\.imagen_aceptado/)).toBeInTheDocument()
  })

  it('el «sí» también va a nombre del tutor', async () => {
    render(
      <RespuestaImagenPapel
        ninoId={NINO}
        tutores={[{ usuarioId: A, nombre: 'Tutor A', respuesta: null }]}
      />
    )
    fireEvent.click(screen.getByText('acuses.imagen_boton_si'))
    await waitFor(() => expect(otorgar).toHaveBeenCalledWith({ nino_id: NINO, tutor_id: A }))
  })

  it('sin ningún tutor legal con cuenta: dice que falta aceptar la invitación y no ofrece nada', () => {
    render(<RespuestaImagenPapel ninoId={NINO} tutores={[]} />)
    expect(screen.getByTestId('alta-imagen-papel-sin-cuenta')).toHaveTextContent(
      'acuses.imagen_papel_sin_cuenta'
    )
    expect(screen.queryByText('acuses.imagen_boton_si')).not.toBeInTheDocument()
    expect(screen.queryByText('acuses.imagen_boton_no')).not.toBeInTheDocument()
  })

  it('si no se pudieron leer los tutores, lo dice', () => {
    render(<RespuestaImagenPapel ninoId={NINO} tutores={null} />)
    expect(screen.getByText('acuses.imagen_papel_no_se_pudo_leer')).toBeInTheDocument()
    expect(screen.queryByTestId('alta-imagen-papel-sin-cuenta')).not.toBeInTheDocument()
  })
})
