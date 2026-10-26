import { describe, expect, it } from 'vitest'

import { cambiosAsignacion, conceptoAsignable } from '../lib/destinatarios-concepto'

describe('cambiosAsignacion', () => {
  it('solo manda lo que cambia, ordenado', () => {
    const inicial = new Set(['a', 'b'])
    const actual = new Set(['b', 'c'])
    expect(cambiosAsignacion(inicial, actual)).toEqual([
      { id: 'a', asignada: false },
      { id: 'c', asignada: true },
    ])
  })

  it('sin cambios, lista vacía (no se puede guardar)', () => {
    expect(cambiosAsignacion(new Set(['a']), new Set(['a']))).toEqual([])
  })
})

describe('conceptoAsignable', () => {
  it('los mismos que ofrece Asignación permanente: activos y manuales', () => {
    expect(conceptoAsignable({ activo: true, aplicacion: 'manual' })).toBe(true)
    expect(conceptoAsignable({ activo: false, aplicacion: 'manual' })).toBe(false)
    expect(conceptoAsignable({ activo: true, aplicacion: 'automatico' })).toBe(false)
  })
})
