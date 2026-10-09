import { describe, expect, it } from 'vitest'

import { estadoMatriculaVigente } from '../matricula-vigente'

describe('estadoMatriculaVigente', () => {
  it('activa + pendiente del curso siguiente (pase de curso) → activa', () => {
    expect(estadoMatriculaVigente([{ estado: 'pendiente' }, { estado: 'activa' }])).toBe('activa')
  })

  it('una sola matrícula → su estado', () => {
    expect(estadoMatriculaVigente([{ estado: 'lista' }])).toBe('lista')
    expect(estadoMatriculaVigente([{ estado: 'pendiente' }])).toBe('pendiente')
  })

  it('lista + pendiente → lista', () => {
    expect(estadoMatriculaVigente([{ estado: 'pendiente' }, { estado: 'lista' }])).toBe('lista')
  })

  it('sin matrículas vigentes → null', () => {
    expect(estadoMatriculaVigente([])).toBeNull()
  })
})
