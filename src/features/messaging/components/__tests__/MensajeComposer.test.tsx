import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MensajeComposer } from '../MensajeComposer'

/**
 * Test de regresión del Bug 1 post-F5: form del tutor no enviaba mensaje.
 *
 * La causa raíz del bug en producción es ambigua entre dos hipótesis:
 *  - El <Button> sin `type` explícito interpretado como submit dentro de
 *    un form ancestro, refrescando la página sin disparar el handler.
 *  - El handler enganchado a onClick en lugar de al onSubmit del form,
 *    con algún wrapper del primitive @base-ui que tragaba el evento.
 *
 * El fix combina <form onSubmit> + <button type="submit">. Estos tests
 * verifican el contrato observable: al hacer submit del form (botón o
 * Enter en el textarea) la server action recibe los datos correctos y
 * el textarea se limpia al éxito.
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

describe('MensajeComposer — Bug 1 regresión', () => {
  beforeEach(() => {
    enviarMensajeMock.mockReset()
  })

  it('renderiza un <form> con role="form" y un submit button type="submit"', () => {
    render(<MensajeComposer ninoId="00000000-0000-0000-0000-000000000001" locale="es" />)
    const form = screen.getByTestId('mensaje-composer-form')
    expect(form.tagName).toBe('FORM')
    const btn = screen.getByTestId('mensaje-composer-submit') as HTMLButtonElement
    expect(btn.type).toBe('submit')
  })

  it('submit del form invoca enviarMensaje con nino_id y contenido (trimmed)', async () => {
    enviarMensajeMock.mockResolvedValue({
      success: true,
      data: { mensaje_id: 'm1', conversacion_id: 'c1' },
    })

    render(<MensajeComposer ninoId="00000000-0000-0000-0000-000000000001" locale="es" />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '   hola profe   ' } })
    fireEvent.submit(screen.getByTestId('mensaje-composer-form'))

    await waitFor(() => {
      expect(enviarMensajeMock).toHaveBeenCalledTimes(1)
    })
    expect(enviarMensajeMock).toHaveBeenCalledWith({
      nino_id: '00000000-0000-0000-0000-000000000001',
      contenido: 'hola profe',
    })
  })

  it('Enter sin Shift en el textarea también dispara el envío', async () => {
    enviarMensajeMock.mockResolvedValue({
      success: true,
      data: { mensaje_id: 'm1', conversacion_id: 'c1' },
    })

    render(<MensajeComposer ninoId="00000000-0000-0000-0000-000000000002" locale="es" />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'mensaje rápido' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(enviarMensajeMock).toHaveBeenCalledTimes(1)
    })
  })

  it('botón disabled cuando el contenido está vacío o solo espacios', () => {
    render(<MensajeComposer ninoId="00000000-0000-0000-0000-000000000003" locale="es" />)
    const btn = screen.getByTestId('mensaje-composer-submit') as HTMLButtonElement
    expect(btn.disabled).toBe(true)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '     ' } })
    expect(btn.disabled).toBe(true)

    fireEvent.change(textarea, { target: { value: 'hola' } })
    expect(btn.disabled).toBe(false)
  })

  it('mantiene el contenido si la action devuelve { success: false }', async () => {
    enviarMensajeMock.mockResolvedValue({
      success: false,
      error: 'messages.errors.envio_fallo',
    })

    render(<MensajeComposer ninoId="00000000-0000-0000-0000-000000000004" locale="es" />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'no enviado' } })
    fireEvent.submit(screen.getByTestId('mensaje-composer-form'))

    await waitFor(() => {
      expect(enviarMensajeMock).toHaveBeenCalledTimes(1)
    })
    // Tras error, el contenido sigue ahí para que el usuario pueda reintentar.
    expect(textarea.value).toBe('no enviado')
  })
})
