import { describe, expect, it } from 'vitest'

import type { MetricasCentro } from '../../types'
import { alertasDe } from '../alertas'

const SANO: MetricasCentro = {
  centroId: '00000000-0000-0000-0000-000000000001',
  nombre: 'Centro Demo',
  cursoActivo: '2026-27',
  ninosMatriculados: 3,
  ninosEnAlta: 1,
  familias: 2,
  personal: 4,
  personalBajaTemporal: 0,
  direccion: 1,
  aulas: 5,
  invitacionesPendientes: 0,
  sinAdmin: false,
  sinCursoActivo: false,
  invitacionAdmin: null,
}

/** Las alertas del panel: las tres que dejan un centro bloqueado, en orden. */
describe('alertasDe', () => {
  it('un centro con admin y curso activo no tiene alertas', () => {
    expect(alertasDe(SANO)).toEqual([])
  })

  it('sin admin, con la invitación de admin pendiente o caducada', () => {
    expect(alertasDe({ ...SANO, sinAdmin: true })).toEqual(['sin_admin'])
    expect(alertasDe({ ...SANO, sinAdmin: true, invitacionAdmin: 'pendiente' })).toEqual([
      'sin_admin',
      'invitacion_admin_pendiente',
    ])
    expect(alertasDe({ ...SANO, sinAdmin: true, invitacionAdmin: 'caducada' })).toEqual([
      'sin_admin',
      'invitacion_admin_caducada',
    ])
  })

  it('sin curso activo, sola o detrás de las de admin', () => {
    expect(alertasDe({ ...SANO, sinCursoActivo: true, cursoActivo: null })).toEqual([
      'sin_curso_activo',
    ])
    expect(
      alertasDe({ ...SANO, sinAdmin: true, sinCursoActivo: true, invitacionAdmin: 'caducada' })
    ).toEqual(['sin_admin', 'invitacion_admin_caducada', 'sin_curso_activo'])
  })
})
