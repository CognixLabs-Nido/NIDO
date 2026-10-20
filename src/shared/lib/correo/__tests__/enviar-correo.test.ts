import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const avisos = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/shared/lib/logger', () => ({
  logger: { warn: avisos.warn, info: vi.fn(), error: vi.fn() },
}))

const { enviarCorreo } = await import('../enviar-correo')

/**
 * PR 1 (Fase 4) — el correo propio de la app sale por la API de Resend, desde no-reply@nido03.es.
 * Nunca lanza, dice si salió, y no deja la dirección ni el contenido en los logs.
 */

const CORREO = {
  para: 'persona@nido.test',
  asunto: 'Asunto de prueba',
  texto: 'Texto de prueba',
  html: '<p>Texto de prueba</p>',
}

const fetchSpy = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubEnv('RESEND_API_KEY', 're_prueba')
  fetchSpy.mockReset()
  avisos.warn.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('enviarCorreo', () => {
  it('manda a Resend con la clave, desde no-reply@nido03.es, y dice que salió', async () => {
    fetchSpy.mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))

    expect(await enviarCorreo(CORREO)).toEqual({ enviado: true })

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_prueba')
    expect(JSON.parse(init.body)).toEqual({
      from: 'NIDO <no-reply@nido03.es>',
      to: ['persona@nido.test'],
      subject: 'Asunto de prueba',
      text: 'Texto de prueba',
      html: '<p>Texto de prueba</p>',
    })
  })

  it('sin RESEND_API_KEY no intenta nada y dice por qué', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    expect(await enviarCorreo(CORREO)).toEqual({ enviado: false, motivo: 'sin_clave' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('Resend lo rechaza → no salió', async () => {
    fetchSpy.mockResolvedValue(new Response('{"message":"x"}', { status: 422 }))

    expect(await enviarCorreo(CORREO)).toEqual({ enviado: false, motivo: 'fallo' })
  })

  it('sin respuesta (red, tiempo agotado) → no salió, sin lanzar', async () => {
    fetchSpy.mockRejectedValue(new DOMException('tiempo', 'TimeoutError'))

    expect(await enviarCorreo(CORREO)).toEqual({ enviado: false, motivo: 'fallo' })
  })

  it('los logs no llevan la dirección ni el contenido', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 500 }))
    await enviarCorreo(CORREO)
    fetchSpy.mockRejectedValue(new Error(`fallo enviando a ${CORREO.para}`))
    await enviarCorreo(CORREO)

    expect(avisos.warn).toHaveBeenCalledTimes(2)
    const logs = JSON.stringify(avisos.warn.mock.calls)
    expect(logs).not.toContain(CORREO.para)
    expect(logs).not.toContain(CORREO.texto)
  })
})
