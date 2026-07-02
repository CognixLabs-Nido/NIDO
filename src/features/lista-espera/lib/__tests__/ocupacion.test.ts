import { describe, expect, it } from 'vitest'

import { contarOcupacionAula, superaCapacidad } from '../ocupacion'

describe('contarOcupacionAula', () => {
  it('cuenta activas y pendientes juntas', () => {
    expect(
      contarOcupacionAula([{ estado: 'activa' }, { estado: 'activa' }, { estado: 'pendiente' }])
    ).toBe(3)
  })

  it('no cuenta bajas', () => {
    expect(contarOcupacionAula([{ estado: 'activa' }, { estado: 'baja' }])).toBe(1)
  })

  it('una invitación (matrícula pendiente) cuenta UNA vez, no doble', () => {
    // La invitación enviada y su matrícula pendiente son la MISMA fila. Un aula con
    // 2 activas + 1 invitación pendiente ocupa 3 plazas, no 4 (2 activas + 1 invitación
    // contada aparte + 1 pendiente).
    const conInvitacion = [{ estado: 'activa' }, { estado: 'activa' }, { estado: 'pendiente' }]
    expect(contarOcupacionAula(conInvitacion as { estado: 'activa' | 'pendiente' }[])).toBe(3)
  })

  it('aula vacía → 0', () => {
    expect(contarOcupacionAula([])).toBe(0)
  })
})

describe('superaCapacidad', () => {
  it('por debajo del límite → no supera', () => {
    expect(superaCapacidad(10, 12)).toBe(false)
  })

  it('justo en el penúltimo hueco (ocupacion+1 = capacidad) → no supera', () => {
    expect(superaCapacidad(11, 12)).toBe(false)
  })

  it('al llenar la última plaza (ocupacion = capacidad) → añadir otra supera', () => {
    expect(superaCapacidad(12, 12)).toBe(true)
  })

  it('ya excedida → supera', () => {
    expect(superaCapacidad(13, 12)).toBe(true)
  })
})
