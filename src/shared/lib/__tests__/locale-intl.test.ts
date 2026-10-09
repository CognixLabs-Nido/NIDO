import { describe, expect, it } from 'vitest'

import { localeIntl } from '../locale-intl'

// 9 de octubre de 2026 a mediodía UTC: el mismo día en cualquier huso de Europa.
const FECHA = new Date(Date.UTC(2026, 9, 9, 12, 0, 0))
const fechaLarga = (locale: string) =>
  new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'long' }).format(FECHA)
// Intl separa el «€» con un espacio de no separación (U+00A0): se ve como un espacio normal.
const euros = (locale: string, importe: number) =>
  new Intl.NumberFormat(localeIntl(locale), { style: 'currency', currency: 'EUR' }).format(importe)

describe('localeIntl — locale de la app → locale de Intl', () => {
  it('mapea los tres idiomas de la app', () => {
    expect(localeIntl('va')).toBe('ca-ES')
    expect(localeIntl('es')).toBe('es-ES')
    expect(localeIntl('en')).toBe('en-GB')
  })

  it('una etiqueta BCP 47 completa pasa tal cual', () => {
    expect(localeIntl('es-ES')).toBe('es-ES')
    expect(localeIntl('en-CA')).toBe('en-CA')
  })

  it('valenciano: fecha «9 d’octubre del 2026», no «October 9, 2026»', () => {
    expect(fechaLarga('va')).toBe('9 d’octubre del 2026')
    expect(
      new Intl.DateTimeFormat(localeIntl('va'), { month: 'long', year: 'numeric' }).format(FECHA)
    ).toBe('octubre del 2026')
  })

  it('valenciano: dinero «1.234,50 €», no «€1,234.50»', () => {
    expect(euros('va', 1234.5)).toBe('1.234,50\u00a0€')
    expect(euros('va', 12345.5)).toBe('12.345,50\u00a0€')
  })

  it('castellano no cambia (es-ES)', () => {
    expect(fechaLarga('es')).toBe('9 de octubre de 2026')
    expect(euros('es', 1234.5)).toBe('1234,50\u00a0€')
    expect(euros('es', 12345.5)).toBe('12.345,50\u00a0€')
  })

  it('inglés en formato británico (en-GB), no en-US', () => {
    expect(fechaLarga('en')).toBe('9 October 2026')
    expect(euros('en', 1234.5)).toBe('€1,234.50')
  })

  it('el control: sin mapear, «va» cae a otro idioma', () => {
    expect(new Intl.DateTimeFormat('va', { dateStyle: 'long' }).format(FECHA)).not.toContain(
      'octubre'
    )
  })
})
