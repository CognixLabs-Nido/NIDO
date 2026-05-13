import { describe, expect, it } from 'vitest'

import { signInSchema } from '../schemas/sign-in'

describe('signInSchema', () => {
  it('acepta email + password no vacíos', () => {
    const result = signInSchema.safeParse({ email: 'test@nido.test', password: 'whatever' })
    expect(result.success).toBe(true)
  })

  it('rechaza email mal formado', () => {
    const result = signInSchema.safeParse({ email: 'no-es-email', password: 'whatever' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('auth.validation.email_invalid')
    }
  })

  it('rechaza password vacío', () => {
    const result = signInSchema.safeParse({ email: 'test@nido.test', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('auth.validation.password_required')
    }
  })
})
