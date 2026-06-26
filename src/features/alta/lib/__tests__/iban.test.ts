import { describe, expect, it } from 'vitest'

import { formatearIban, ibanValido, normalizarIban } from '../iban'

describe('iban', () => {
  it('normaliza quitando espacios/guiones y en mayúsculas', () => {
    expect(normalizarIban('es91 2100-0418 4502 0005 1332')).toBe('ES9121000418450200051332')
  })

  it('formatea en bloques de 4', () => {
    expect(formatearIban('ES9121000418450200051332')).toBe('ES91 2100 0418 4502 0005 1332')
  })

  it('acepta IBAN español válido (con y sin espacios)', () => {
    expect(ibanValido('ES9121000418450200051332')).toBe(true)
    expect(ibanValido('ES91 2100 0418 4502 0005 1332')).toBe(true)
  })

  it('rechaza checksum incorrecto', () => {
    expect(ibanValido('ES9221000418450200051332')).toBe(false)
  })

  it('rechaza longitud incorrecta para el país', () => {
    expect(ibanValido('ES91210004184502000513')).toBe(false)
  })

  it('rechaza estructura inválida', () => {
    expect(ibanValido('1234')).toBe(false)
    expect(ibanValido('')).toBe(false)
    expect(ibanValido('ESAB2100041845020005133X')).toBe(false)
  })
})
