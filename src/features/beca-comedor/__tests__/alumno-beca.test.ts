import { describe, expect, it } from 'vitest'

import { alternarAnio, aniosDe } from '../lib/alumno-beca'

const alumnos = [
  { id: 'a', anioNacimiento: 2024 },
  { id: 'b', anioNacimiento: 2025 },
  { id: 'c', anioNacimiento: 2024 },
  { id: 'd', anioNacimiento: null },
]

describe('aniosDe', () => {
  it('sin repetir, sin vacíos, del más reciente al más antiguo', () => {
    expect(aniosDe(alumnos)).toEqual([2025, 2024])
  })
})

describe('alternarAnio', () => {
  it('añade a todos los de ese año y conserva lo que ya había', () => {
    expect([...alternarAnio(new Set(['b']), alumnos, 2024)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('con todos los de ese año elegidos, los quita y deja el resto', () => {
    expect([...alternarAnio(new Set(['a', 'b', 'c']), alumnos, 2024)]).toEqual(['b'])
  })

  it('con algunos de ese año elegidos, completa el año', () => {
    expect([...alternarAnio(new Set(['a']), alumnos, 2024)].sort()).toEqual(['a', 'c'])
  })

  it('un año sin alumnos no cambia nada', () => {
    expect([...alternarAnio(new Set(['b']), alumnos, 2023)]).toEqual(['b'])
  })
})
