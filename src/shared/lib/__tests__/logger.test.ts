import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { logger } from '../logger'

/** `logger.error` manda el fallo a Sentry (ADR-0056); `warn` e `info` no. */
describe('logger → Sentry', () => {
  beforeEach(() => {
    captureException.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('error con un Error: lo envía tal cual, con el resto como contexto', () => {
    const fallo = new Error('select falló')
    logger.error('getFicha:', fallo, { code: '42501' })
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(fallo, {
      extra: { contexto: ['getFicha:', { code: '42501' }] },
    })
  })

  it('error sin Error: crea uno con el primer texto (mensaje y traza)', () => {
    logger.error('getFicha: select', 'permission denied')
    const [enviado] = captureException.mock.calls[0] ?? []
    expect(enviado).toBeInstanceOf(Error)
    expect((enviado as Error).message).toBe('getFicha: select')
  })

  it('error sigue escribiendo en la consola (los logs de Vercel)', () => {
    logger.error('algo')
    expect(console.error).toHaveBeenCalledWith('[error]', 'algo')
  })

  it('control: warn e info no envían nada a Sentry', () => {
    logger.warn('aviso')
    logger.info('dato')
    expect(captureException).not.toHaveBeenCalled()
  })
})
