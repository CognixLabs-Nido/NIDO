import { describe, expect, it } from 'vitest'

import {
  MATRICULA_ESTADO_ACTIVA,
  aplicarMatriculaActiva,
  esMatriculaActiva,
} from '../matricula-activa'

describe('esMatriculaActiva', () => {
  it('es true solo para fecha_baja=null + deleted_at=null + estado=activa', () => {
    expect(esMatriculaActiva({ fecha_baja: null, deleted_at: null, estado: 'activa' })).toBe(true)
  })

  it("excluye 'pendiente' aunque fecha_baja y deleted_at sean null (esqueleto)", () => {
    expect(esMatriculaActiva({ fecha_baja: null, deleted_at: null, estado: 'pendiente' })).toBe(
      false
    )
  })

  it("excluye 'baja' y filas con fecha_baja o deleted_at", () => {
    expect(esMatriculaActiva({ fecha_baja: null, deleted_at: null, estado: 'baja' })).toBe(false)
    expect(esMatriculaActiva({ fecha_baja: '2026-10-01', deleted_at: null, estado: 'baja' })).toBe(
      false
    )
    expect(
      esMatriculaActiva({ fecha_baja: null, deleted_at: '2026-10-01', estado: 'activa' })
    ).toBe(false)
    expect(esMatriculaActiva({ fecha_baja: null, deleted_at: null, estado: null })).toBe(false)
  })
})

describe('aplicarMatriculaActiva', () => {
  it('encadena fecha_baja IS NULL + deleted_at IS NULL + estado = activa', () => {
    const calls: Array<[string, unknown]> = []
    const qb = {
      is(column: 'fecha_baja' | 'deleted_at', value: null) {
        calls.push([`is:${column}`, value])
        return this
      },
      eq(column: 'estado', value: typeof MATRICULA_ESTADO_ACTIVA) {
        calls.push([`eq:${column}`, value])
        return this
      },
    }
    const out = aplicarMatriculaActiva(qb)
    expect(out).toBe(qb)
    expect(calls).toEqual([
      ['is:fecha_baja', null],
      ['is:deleted_at', null],
      ['eq:estado', 'activa'],
    ])
  })

  it('usa la constante única de estado activa', () => {
    expect(MATRICULA_ESTADO_ACTIVA).toBe('activa')
  })
})
