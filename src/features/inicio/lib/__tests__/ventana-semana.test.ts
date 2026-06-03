import { describe, expect, it } from 'vitest'

import { fechaMadrid, ventanaSemana } from '../ventana-semana'

describe('ventanaSemana — semana ISO (lun–dom) en huso Madrid', () => {
  it('un miércoles devuelve lunes…domingo de esa semana', () => {
    // 2026-06-03 es miércoles
    const v = ventanaSemana(new Date('2026-06-03T10:00:00Z'))
    expect(v).toEqual({ hoy: '2026-06-03', desde: '2026-06-01', hasta: '2026-06-07' })
  })

  it('un lunes es el inicio de su propia semana', () => {
    const v = ventanaSemana(new Date('2026-06-01T08:00:00Z'))
    expect(v).toEqual({ hoy: '2026-06-01', desde: '2026-06-01', hasta: '2026-06-07' })
  })

  it('un domingo cierra su semana (no abre la siguiente)', () => {
    const v = ventanaSemana(new Date('2026-06-07T12:00:00Z'))
    expect(v).toEqual({ hoy: '2026-06-07', desde: '2026-06-01', hasta: '2026-06-07' })
  })

  it('cruza el fin de mes correctamente', () => {
    // 2026-07-01 es miércoles → semana 29 jun … 5 jul
    const v = ventanaSemana(new Date('2026-07-01T10:00:00Z'))
    expect(v).toEqual({ hoy: '2026-07-01', desde: '2026-06-29', hasta: '2026-07-05' })
  })

  it('fechaMadrid: 23:30Z en verano (UTC+2) cae en el día siguiente Madrid', () => {
    // 2026-06-02T23:30Z = 2026-06-03T01:30 en Madrid
    expect(fechaMadrid(new Date('2026-06-02T23:30:00Z'))).toBe('2026-06-03')
  })
})
