import { describe, expect, it, vi } from 'vitest'

import { isRateLimitError, isRetryableAuthError, isTransientJwtError, withRetry } from '../setup'

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

describe('isTransientJwtError', () => {
  it('detecta el "kid <nil>" ES256 de la rotación de signing keys', () => {
    expect(
      isTransientJwtError(
        new Error(
          'invalid JWT: unable to parse or verify signature, unrecognized JWT kid <nil> for algorithm ES256'
        )
      )
    ).toBe(true)
  })

  it('detecta "unrecognized JWT kid" y "unable to verify signature"', () => {
    expect(isTransientJwtError({ message: 'unrecognized JWT kid abc for algorithm ES256' })).toBe(
      true
    )
    expect(isTransientJwtError(new Error('unable to verify signature'))).toBe(true)
  })

  it('NO detecta errores no relacionados (credenciales, rate-limit, null)', () => {
    expect(isTransientJwtError(new Error('invalid credentials'))).toBe(false)
    expect(isTransientJwtError(new Error('Request rate limit reached'))).toBe(false)
    expect(isTransientJwtError(null)).toBe(false)
    expect(isTransientJwtError(undefined)).toBe(false)
  })
})

describe('isRetryableAuthError', () => {
  it('es true para rate-limit Y para el JWT transitorio', () => {
    expect(isRetryableAuthError({ status: 429, message: 'too many requests' })).toBe(true)
    expect(isRetryableAuthError(new Error('unrecognized JWT kid <nil> for algorithm ES256'))).toBe(
      true
    )
  })

  it('es false para un error real (no enmascara bugs)', () => {
    expect(isRetryableAuthError(new Error('invalid credentials'))).toBe(false)
    expect(isRetryableAuthError(null)).toBe(false)
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
    // Backoff exponencial sobre baseDelayMs por defecto (2000ms): 2000ms, 4000ms.
    expect(sleep).toHaveBeenNthCalledWith(1, 2000)
    expect(sleep).toHaveBeenNthCalledWith(2, 4000)
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
    // Default attempts = 5.
    expect(fn).toHaveBeenCalledTimes(5)
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
