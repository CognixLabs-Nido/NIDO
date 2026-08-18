import { describe, expect, it } from 'vitest'

import { altaEnProceso, fueAlumno, type SenalMatricula } from '../estado-alumno'

const m = (
  estado: SenalMatricula['estado'],
  activada_at: string | null = null
): SenalMatricula => ({
  estado,
  activada_at,
})

const SELLO = '2026-07-21T08:57:36.993Z'

describe('fueAlumno — ¿matriculado ahora o alguna vez?', () => {
  it('sin matrículas, no', () => {
    expect(fueAlumno([])).toBe(false)
  })

  it('alta a medias (pendiente/lista, nunca activada) → NO es alumno', () => {
    expect(fueAlumno([m('pendiente')])).toBe(false)
    expect(fueAlumno([m('lista')])).toBe(false)
  })

  it('matriculado ahora → sí', () => {
    expect(fueAlumno([m('activa', SELLO)])).toBe(true)
  })

  // El corazón de la columna: por `estado` estas dos filas son idénticas ('baja'), y sin el
  // sello no había forma de distinguir al ex-alumno del alta a medias archivada.
  it('ex-alumno (baja CON sello) → sí; alta a medias archivada (baja SIN sello) → no', () => {
    expect(fueAlumno([m('baja', SELLO)])).toBe(true)
    expect(fueAlumno([m('baja')])).toBe(false)
  })

  it('basta con que UNA matrícula esté sellada (pasó de curso: baja vieja + activa nueva)', () => {
    expect(fueAlumno([m('baja', SELLO), m('activa', SELLO)])).toBe(true)
    expect(fueAlumno([m('baja'), m('pendiente')])).toBe(false)
  })
})

describe('altaEnProceso — ¿pinta algo en Admisiones?', () => {
  it('prospecto sin promover (sin matrículas) → sigue en la lista', () => {
    expect(altaEnProceso([])).toBe(true)
  })

  it('alta a medias → sigue en la lista', () => {
    expect(altaEnProceso([m('pendiente')])).toBe(true)
    expect(altaEnProceso([m('lista')])).toBe(true)
  })

  it('matriculado o dado de baja → resuelto, sale de la lista', () => {
    expect(altaEnProceso([m('activa', SELLO)])).toBe(false)
    expect(altaEnProceso([m('baja', SELLO)])).toBe(false)
    expect(altaEnProceso([m('baja')])).toBe(false)
  })

  it('se resuelve por ESTADO, no por el sello: una baja sin sellar también cierra el proceso', () => {
    expect(altaEnProceso([m('baja')])).toBe(false)
    expect(fueAlumno([m('baja')])).toBe(false) // …aunque no cuente como alumno
  })

  it('una sola matrícula resuelta basta para sacarlo, aunque haya otra en proceso', () => {
    expect(altaEnProceso([m('pendiente'), m('activa', SELLO)])).toBe(false)
  })
})
