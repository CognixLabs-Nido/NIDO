import { describe, expect, it } from 'vitest'

import { cantidadANumero, ESCALA_1_5_OPTIONS, numeroACantidad } from '../escala'

describe('escala 1-5 ↔ cantidad_comida', () => {
  it('cantidadANumero mapea bidireccional con numeroACantidad', () => {
    expect(cantidadANumero('nada')).toBe(1)
    expect(cantidadANumero('poco')).toBe(2)
    expect(cantidadANumero('mitad')).toBe(3)
    expect(cantidadANumero('mayoria')).toBe(4)
    expect(cantidadANumero('todo')).toBe(5)
  })

  it('numeroACantidad invierte cantidadANumero', () => {
    expect(numeroACantidad(1)).toBe('nada')
    expect(numeroACantidad(2)).toBe('poco')
    expect(numeroACantidad(3)).toBe('mitad')
    expect(numeroACantidad(4)).toBe('mayoria')
    expect(numeroACantidad(5)).toBe('todo')
  })

  it('ESCALA_1_5_OPTIONS tiene 5 entradas en orden ascendente', () => {
    expect(ESCALA_1_5_OPTIONS).toHaveLength(5)
    expect(ESCALA_1_5_OPTIONS.map((o) => o.label)).toEqual(['1', '2', '3', '4', '5'])
    expect(ESCALA_1_5_OPTIONS[0].value).toBe('nada')
    expect(ESCALA_1_5_OPTIONS[4].value).toBe('todo')
  })
})
