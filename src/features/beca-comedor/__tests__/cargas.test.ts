import { describe, expect, it } from 'vitest'

import { agruparCargas, mesCerrado, mesesDelCurso, type TramoParaCarga } from '../lib/cargas'
import { mesKey } from '../lib/meses'
import { cargaBecaSchema, toggleElegibilidadSchema } from '../schemas/beca-comedor'

describe('mesesDelCurso', () => {
  it('cubre el curso de septiembre a julio (11 meses)', () => {
    const meses = mesesDelCurso('2026-09-01', '2027-07-31')
    expect(meses).toHaveLength(11)
    expect(meses[0]).toEqual({ anio: 2026, mes: 9 })
    expect(meses[10]).toEqual({ anio: 2027, mes: 7 })
    // cruza el cambio de año correctamente
    expect(meses).toContainEqual({ anio: 2026, mes: 12 })
    expect(meses).toContainEqual({ anio: 2027, mes: 1 })
  })

  it('un solo mes cuando inicio y fin caen en el mismo mes', () => {
    expect(mesesDelCurso('2026-09-05', '2026-09-20')).toEqual([{ anio: 2026, mes: 9 }])
  })

  it('no entra en bucle si las fechas vienen invertidas', () => {
    expect(mesesDelCurso('2027-05-01', '2026-01-01')).toEqual([])
  })
})

describe('agruparCargas', () => {
  const t = (
    mesCorr: number,
    mesAplic: number,
    importe: number,
    anioCorr = 2026,
    anioAplic = 2027
  ): TramoParaCarga => ({
    anio_correspondiente: anioCorr,
    mes_correspondiente: mesCorr,
    anio_aplicacion: anioAplic,
    mes_aplicacion: mesAplic,
    importe_centimos: importe,
  })

  it('agrupa por (año/mes corr, año/mes aplic, importe) y cuenta becados', () => {
    // 3 becados en la carga de septiembre, 2 en la de octubre
    const cargas = agruparCargas([
      t(9, 1, 5000),
      t(9, 1, 5000),
      t(9, 1, 5000),
      t(10, 1, 4000),
      t(10, 1, 4000),
    ])
    expect(cargas).toHaveLength(2)
    expect(cargas[0]).toMatchObject({
      mesCorrespondiente: 9,
      mesAplicacion: 1,
      importeCentimos: 5000,
      nBecados: 3,
    })
    expect(cargas[1]).toMatchObject({ mesCorrespondiente: 10, nBecados: 2 })
  })

  it('ordena por mes correspondiente ascendente', () => {
    const cargas = agruparCargas([t(11, 1, 3000), t(9, 1, 5000), t(10, 1, 4000)])
    expect(cargas.map((c) => c.mesCorrespondiente)).toEqual([9, 10, 11])
  })

  it('lista vacía → sin cargas', () => {
    expect(agruparCargas([])).toEqual([])
  })
})

describe('mesCerrado', () => {
  const cierres = [
    { anio: 2026, mes: 12 },
    { anio: 2027, mes: 1 },
  ]
  it('true si (año,mes) está en la lista de cierres', () => {
    expect(mesCerrado(cierres, 2026, 12)).toBe(true)
    expect(mesCerrado(cierres, 2027, 1)).toBe(true)
  })
  it('false si no está', () => {
    expect(mesCerrado(cierres, 2026, 11)).toBe(false)
    expect(mesCerrado([], 2026, 12)).toBe(false)
  })
})

describe('mesKey', () => {
  it('serializa (año, mes) a "anio-mes"', () => {
    expect(mesKey(2026, 9)).toBe('2026-9')
  })
})

describe('cargaBecaSchema', () => {
  const base = {
    anio_correspondiente: 2026,
    mes_correspondiente: 9,
    anio_aplicacion: 2027,
    mes_aplicacion: 1,
    importe_euros: 30,
  }
  it('acepta una carga válida', () => {
    expect(cargaBecaSchema.safeParse(base).success).toBe(true)
  })
  it('rechaza importe <= 0', () => {
    expect(cargaBecaSchema.safeParse({ ...base, importe_euros: 0 }).success).toBe(false)
    expect(cargaBecaSchema.safeParse({ ...base, importe_euros: -5 }).success).toBe(false)
  })
  it('rechaza mes fuera de rango', () => {
    expect(cargaBecaSchema.safeParse({ ...base, mes_aplicacion: 13 }).success).toBe(false)
  })
})

describe('toggleElegibilidadSchema', () => {
  it('acepta uuid + boolean', () => {
    const r = toggleElegibilidadSchema.safeParse({
      nino_id: '11111111-1111-4111-8111-111111111111',
      activa: true,
    })
    expect(r.success).toBe(true)
  })
  it('rechaza nino_id no-uuid', () => {
    expect(toggleElegibilidadSchema.safeParse({ nino_id: 'x', activa: true }).success).toBe(false)
  })
})
