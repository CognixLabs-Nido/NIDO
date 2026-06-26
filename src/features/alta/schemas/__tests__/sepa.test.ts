import { describe, expect, it } from 'vitest'

import { sepaMandatoFormSchema } from '../sepa'

describe('sepaMandatoFormSchema', () => {
  it('acepta IBAN válido + titular', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES91 2100 0418 4502 0005 1332',
      titular: 'Tutor Demo',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza IBAN con checksum inválido', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES9221000418450200051332',
      titular: 'Tutor Demo',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('alta.sepa.errors.iban')
  })

  it('rechaza titular demasiado corto', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES9121000418450200051332',
      titular: 'X',
    })
    expect(r.success).toBe(false)
  })
})
