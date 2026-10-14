import { describe, expect, it } from 'vitest'

import { centimosAEuros, eurosACentimos, formatEuros } from '../format-money'

describe('format-money', () => {
  it('eurosACentimos redondea a céntimos enteros', () => {
    expect(eurosACentimos(6)).toBe(600)
    expect(eurosACentimos(6.5)).toBe(650)
    expect(eurosACentimos(6.005)).toBe(601) // 600.5 → 601 (redondeo)
    expect(eurosACentimos(0)).toBe(0)
  })

  it('centimosAEuros es la inversa exacta para enteros', () => {
    expect(centimosAEuros(600)).toBe(6)
    expect(centimosAEuros(650)).toBe(6.5)
    expect(centimosAEuros(0)).toBe(0)
  })

  it('round-trip euros→céntimos→euros conserva 2 decimales', () => {
    for (const euros of [0, 6, 6.5, 90, 199.99]) {
      expect(centimosAEuros(eurosACentimos(euros))).toBeCloseTo(euros, 2)
    }
  })

  it('formatEuros muestra el importe en euros con 2 decimales y símbolo €', () => {
    const s = formatEuros(600, 'es')
    expect(s).toContain('6,00')
    expect(s).toContain('€')
    expect(formatEuros(9000, 'es')).toContain('90,00')
  })

  // El idioma es obligatorio: antes llevaba `'es-ES'` por defecto y 22 de 32 llamadas no lo
  // pasaban, así que en inglés y en valenciano los importes salían con el formato de `es`.
  // Intl separa el «€» con un espacio de no separación (U+00A0).
  it('formatEuros sigue el idioma de la app: es, en y va', () => {
    expect(formatEuros(123450, 'es')).toBe('1234,50\u00a0€')
    expect(formatEuros(1234550, 'es')).toBe('12.345,50\u00a0€')
    expect(formatEuros(123450, 'en')).toBe('€1,234.50')
    expect(formatEuros(123450, 'va')).toBe('1.234,50\u00a0€')
  })

  it('formatEuros acepta también una etiqueta BCP 47 completa', () => {
    expect(formatEuros(123450, 'es-ES')).toBe(formatEuros(123450, 'es'))
    expect(formatEuros(123450, 'ca-ES')).toBe(formatEuros(123450, 'va'))
  })
})
