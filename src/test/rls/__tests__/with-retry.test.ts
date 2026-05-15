import { describe, expect, it, vi } from 'vitest'

import { isRateLimitError, withRetry } from '../setup'

/**
 * Tests del helper de retry usado por `clientFor()` para sobrevivir al
 * rate-limit de Supabase Auth en CI. Verifica las dos garantías clave:
 *  - reintenta SOLO si `shouldRetry` lo permite (por defecto: rate-limit).
 *  - falla inmediatamente en cualquier otro error.
 *
 * El sleep se inyecta para que el test no espere de verdad.
 */
describe('isRateLimitError', () => {
  it('detecta status 429', () => {
    expect(isRateLimitError({ status: 429, message: 'too many requests' })).toBe(true)
  })

  it('detecta código over_request_rate_limit', () => {
    expect(isRateLimitError({ code: 'over_request_rate_limit', message: 'x' })).toBe(true)
  })

  it('detecta mensaje "rate limit reached"', () => {
    expect(isRateLimitError(new Error('Request rate limit reached'))).toBe(true)
  })

  it('NO detecta errores no relacionados', () => {
    expect(isRateLimitError(new Error('invalid credentials'))).toBe(false)
    expect(isRateLimitError(new Error('network unreachable'))).toBe(false)
    expect(isRateLimitError(null)).toBe(false)
    expect(isRateLimitError(undefined)).toBe(false)
  })
})

describe('withRetry', () => {
  it('devuelve el resultado si la primera llamada tiene éxito', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn, { sleep: async () => {} })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reintenta en error de rate-limit y termina devolviendo el resultado', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('Request rate limit reached')
      return 'ok'
    })
    const sleep = vi.fn(async () => {})
    const result = await withRetry(fn, { sleep })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    // Backoff exponencial: 1000ms, luego 2000ms.
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 2000)
  })

  it('agota los reintentos y propaga el último error de rate-limit', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Request rate limit reached')
    })
    await expect(
      withRetry(fn, {
        sleep: async () => {},
      })
    ).rejects.toThrow('rate limit')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('NO reintenta si el error no es rate-limit (falla inmediatamente)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('invalid credentials')
    })
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow('invalid credentials')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respeta un shouldRetry custom', async () => {
    const fn = vi.fn(async () => {
      throw new Error('transient')
    })
    await expect(
      withRetry(fn, {
        attempts: 2,
        sleep: async () => {},
        shouldRetry: (err) => err instanceof Error && err.message === 'transient',
      })
    ).rejects.toThrow('transient')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
