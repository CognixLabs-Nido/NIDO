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
    const s = formatEuros(600)
    expect(s).toContain('6,00')
    expect(s).toContain('€')
    expect(formatEuros(9000)).toContain('90,00')
  })
})
