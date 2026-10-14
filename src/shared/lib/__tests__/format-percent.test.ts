import { describe, expect, it } from 'vitest'

import { formatPorcentaje } from '../format-percent'

// Intl separa el «%» con un espacio de no separación (U+00A0) en castellano y valenciano.
describe('formatPorcentaje — puntos básicos en el idioma de la app', () => {
  it('es y va: coma decimal y espacio antes del %', () => {
    expect(formatPorcentaje(1250, 'es')).toBe('12,5 %')
    expect(formatPorcentaje(1250, 'va')).toBe('12,5 %')
    expect(formatPorcentaje(1000, 'es')).toBe('10 %')
  })

  it('en: punto decimal y % pegado', () => {
    expect(formatPorcentaje(1250, 'en')).toBe('12.5%')
    expect(formatPorcentaje(1000, 'en')).toBe('10%')
  })

  it('conserva los dos decimales de los puntos básicos', () => {
    expect(formatPorcentaje(333, 'es')).toBe('3,33 %')
    expect(formatPorcentaje(333, 'en')).toBe('3.33%')
  })

  it('acepta también una etiqueta BCP 47 completa', () => {
    expect(formatPorcentaje(1250, 'ca-ES')).toBe(formatPorcentaje(1250, 'va'))
  })
})
