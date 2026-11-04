import { describe, expect, it } from 'vitest'

import { sepaMandatoFormSchema } from '../sepa'

describe('sepaMandatoFormSchema', () => {
  it('acepta IBAN válido + titular', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES91 2100 0418 4502 0005 1332',
      titular: 'Tutor Demo',
      titular_documento: '12345678Z',
      titular_direccion: 'Calle Demo 1, Valencia',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza IBAN con checksum inválido', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES9221000418450200051332',
      titular: 'Tutor Demo',
      titular_documento: '12345678Z',
      titular_direccion: 'Calle Demo 1, Valencia',
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.message).toBe('alta.sepa.errors.iban')
  })

  it('rechaza titular demasiado corto', () => {
    const r = sepaMandatoFormSchema.safeParse({
      iban: 'ES9121000418450200051332',
      titular: 'X',
      titular_documento: '12345678Z',
      titular_direccion: 'Calle Demo 1, Valencia',
    })
    expect(r.success).toBe(false)
  })

  it('0c-2: «NIF o documento de identidad», con dígito de control solo si tiene forma española', () => {
    const base = {
      iban: 'ES9121000418450200051332',
      titular: 'Tutor Demo',
      titular_direccion: 'Calle Demo 1, Valencia',
    }
    for (const doc of ['12345678Z', 'X1234567L', 'B12345674', 'FR 12AB34567', 'P1234567']) {
      expect
        .soft(sepaMandatoFormSchema.safeParse({ ...base, titular_documento: doc }).success, doc)
        .toBe(true)
    }
    for (const doc of ['12345678A', 'X1234567A', 'B12345670', '', ' ']) {
      const r = sepaMandatoFormSchema.safeParse({ ...base, titular_documento: doc })
      expect.soft(r.success, doc).toBe(false)
      if (!r.success)
        expect.soft(r.error.issues[0]?.message, doc).toBe('alta.sepa.errors.documento')
    }
    const sinDir = sepaMandatoFormSchema.safeParse({
      ...base,
      titular_documento: '12345678Z',
      titular_direccion: 'C/1',
    })
    expect(sinDir.success).toBe(false)
    if (!sinDir.success) expect(sinDir.error.issues[0]?.message).toBe('alta.sepa.errors.direccion')
  })
})
