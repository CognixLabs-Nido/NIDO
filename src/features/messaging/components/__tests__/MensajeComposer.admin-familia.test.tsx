import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MensajeComposer } from '../MensajeComposer'

/**
 * Tests específicos de la rama `mode='admin_familia'` del composer (F5.6-A).
 *
 * Cubre lo nuevo:
 *  - Aviso "conversación cerrada" + composer deshabilitado cuando
 *    `expiresAt <= now()`.
 *  - Composer activo cuando el hilo no ha caducado.
 *  - El envío llama `enviarMensaje` con `{ kind: 'admin_familia',
 *    conversacion_id, contenido }` (en vez de la forma legacy
 *    `{ nino_id, contenido }`).
 */

const enviarMensajeMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${key}:${JSON.stringify(vars)}`
    }
    return key
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../actions/enviar-mensaje', () => ({
  enviarMensaje: (...args: unknown[]) => enviarMensajeMock(...args),
}))

const CONV = '00000000-0000-0000-0000-000000000010'

describe('MensajeComposer — admin_familia', () => {
  beforeEach(() => {
    enviarMensajeMock.mockReset()
  })

  it('renderiza aviso "composer cerrado" y deshabilita textarea + submit cuando caducada', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(
      <MensajeComposer mode="admin_familia" conversacionId={CONV} expiresAt={past} locale="es" />
    )
    expect(screen.getByTestId('composer-cerrado')).not.toBeNull()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    const btn = screen.getByTestId('mensaje-composer-submit') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('hilo activo: composer habilitado y envía con kind=admin_familia + conversacion_id', async () => {
    enviarMensajeMock.mockResolvedValue({
      success: true,
      data: { mensaje_id: 'm1', conversacion_id: CONV },
    })
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    render(
      <MensajeComposer mode="admin_familia" conversacionId={CONV} expiresAt={future} locale="es" />
    )
    expect(screen.queryByTestId('composer-cerrado')).toBeNull()

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '   hola familia   ' } })
    fireEvent.submit(screen.getByTestId('mensaje-composer-form'))

    await waitFor(() => {
      expect(enviarMensajeMock).toHaveBeenCalledTimes(1)
    })
    expect(enviarMensajeMock).toHaveBeenCalledWith({
      kind: 'admin_familia',
      conversacion_id: CONV,
      contenido: 'hola familia',
    })
  })

  it('mapea el error conversacion_caducada y NO limpia el textarea', async () => {
    enviarMensajeMock.mockResolvedValue({
      success: false,
      error: 'messages.errors.conversacion_caducada',
    })
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    render(
      <MensajeComposer mode="admin_familia" conversacionId={CONV} expiresAt={future} locale="es" />
    )
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'mensaje a perdido' } })
    fireEvent.submit(screen.getByTestId('mensaje-composer-form'))

    await waitFor(() => {
      expect(enviarMensajeMock).toHaveBeenCalledTimes(1)
    })
    expect(textarea.value).toBe('mensaje a perdido')
  })
})
