import { describe, expect, it } from 'vitest'

import { passwordSchema } from '../schemas/password'

describe('passwordSchema', () => {
  it('acepta una contraseña fuerte', () => {
    const result = passwordSchema.safeParse('Anaia2026!seguro')
    expect(result.success).toBe(true)
  })

  it('rechaza si tiene menos de 12 caracteres', () => {
    const result = passwordSchema.safeParse('Aa1!aaaaa')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('auth.validation.password.too_short')
    }
  })

  it('rechaza si no tiene mayúscula', () => {
    const result = passwordSchema.safeParse('anaia-2026-pass!')
    expect(result.success).toBe(false)
  })

  it('rechaza si no tiene número', () => {
    const result = passwordSchema.safeParse('AnaiaSeguroPass!')
    expect(result.success).toBe(false)
  })

  it('rechaza si no tiene símbolo', () => {
    const result = passwordSchema.safeParse('AnaiaSeguraPass99')
    expect(result.success).toBe(false)
  })
})
