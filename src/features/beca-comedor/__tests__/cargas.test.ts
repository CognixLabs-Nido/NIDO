import { describe, expect, it } from 'vitest'

import {
  agruparCargas,
  becadosSinImporte,
  cargaAnterior,
  mesCerrado,
  mesesDelCurso,
  planGuardarCarga,
  type CargaAgrupada,
  type TramoExistente,
  type TramoParaCarga,
} from '../lib/cargas'
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
    nino: string,
    mesCorr: number,
    mesAplic: number,
    importe: number,
    estado: TramoParaCarga['estado'] = 'pendiente',
    anioCorr = 2026,
    anioAplic = 2027
  ): TramoParaCarga => ({
    nino_id: nino,
    anio_correspondiente: anioCorr,
    mes_correspondiente: mesCorr,
    anio_aplicacion: anioAplic,
    mes_aplicacion: mesAplic,
    importe_centimos: importe,
    estado,
  })

  it('una carga por mes correspondiente, con el importe de cada alumno (PR-10)', () => {
    const cargas = agruparCargas([
      t('a', 9, 1, 5000),
      t('b', 9, 1, 3000),
      t('c', 9, 1, 5000),
      t('a', 10, 1, 4000),
      t('b', 10, 1, 4000),
    ])
    expect(cargas).toHaveLength(2)
    expect(cargas[0]).toMatchObject({
      mesCorrespondiente: 9,
      mesAplicacion: 1,
      nBecados: 3,
      importesDistintos: [3000, 5000],
      importes: {
        a: { centimos: 5000, aplicado: false },
        b: { centimos: 3000, aplicado: false },
        c: { centimos: 5000, aplicado: false },
      },
    })
    expect(cargas[1]).toMatchObject({
      mesCorrespondiente: 10,
      nBecados: 2,
      importesDistintos: [4000],
    })
  })

  it('ordena por mes correspondiente ascendente, cruzando el año', () => {
    const cargas = agruparCargas([
      t('a', 1, 1, 3000, 'pendiente', 2027),
      t('a', 11, 1, 3000),
      t('a', 9, 1, 5000),
    ])
    expect(cargas.map((c) => [c.anioCorrespondiente, c.mesCorrespondiente])).toEqual([
      [2026, 9],
      [2026, 11],
      [2027, 1],
    ])
  })

  it('lista vacía → sin cargas', () => {
    expect(agruparCargas([])).toEqual([])
  })

  // PR-5: cuántos tramos de la carga ya están descontados en un recibo validado.
  it('cuenta los tramos aplicados de cada carga y los marca por alumno', () => {
    const cargas = agruparCargas([
      t('a', 9, 1, 5000, 'aplicada'),
      t('b', 9, 1, 5000, 'pendiente'),
      t('c', 9, 1, 5000, 'aplicada'),
      t('a', 10, 1, 4000, 'anulada'),
    ])
    expect(cargas.map((c) => [c.mesCorrespondiente, c.nBecados, c.nAplicados])).toEqual([
      [9, 3, 2],
      [10, 1, 0],
    ])
    expect(cargas[0]!.importes.a!.aplicado).toBe(true)
    expect(cargas[0]!.importes.b!.aplicado).toBe(false)
  })
})

describe('cargaAnterior (PR-10: la carga nueva se rellena con la anterior)', () => {
  const carga = (anio: number, mes: number, importes: Record<string, number>): CargaAgrupada => ({
    anioCorrespondiente: anio,
    mesCorrespondiente: mes,
    anioAplicacion: anio,
    mesAplicacion: mes,
    importes: Object.fromEntries(
      Object.entries(importes).map(([k, v]) => [k, { centimos: v, aplicado: false }])
    ),
    importesDistintos: [],
    nBecados: Object.keys(importes).length,
    nAplicados: 0,
  })
  const sep = carga(2026, 9, { a: 5000 })
  const oct = carga(2026, 10, { a: 5000, b: 3000 })
  const ene = carga(2027, 1, { a: 4500 })

  it('la del mes correspondiente más reciente ANTES del elegido', () => {
    expect(cargaAnterior([sep, oct, ene], 2026, 11)).toBe(oct)
    // Sin carga en noviembre ni diciembre: enero se rellena con octubre.
    expect(cargaAnterior([ene, sep, oct], 2027, 1)).toBe(oct)
    expect(cargaAnterior([sep, oct, ene], 2027, 2)).toBe(ene)
  })

  it('nunca la del propio mes ni una posterior', () => {
    expect(cargaAnterior([sep, oct], 2026, 9)).toBeNull()
    expect(cargaAnterior([oct, ene], 2026, 10)).toBeNull()
  })

  it('sin cargas → null', () => {
    expect(cargaAnterior([], 2026, 10)).toBeNull()
  })

  it('becadosSinImporte: los becados que no tienen importe en la carga', () => {
    expect(becadosSinImporte(oct, ['a', 'b', 'c'])).toEqual(['c'])
    expect(becadosSinImporte(oct, ['a', 'b'])).toEqual([])
  })
})

describe('planGuardarCarga (PR-10)', () => {
  const tr = (
    id: string,
    nino: string,
    importe: number,
    estado: TramoExistente['estado'] = 'pendiente'
  ): TramoExistente => ({ id, nino_id: nino, importe_centimos: importe, estado })

  it('crear: un tramo por alumno con importe; sin importe, ninguno', () => {
    const p = planGuardarCarga(
      [],
      [
        { nino_id: 'a', importe_centimos: 5000 },
        { nino_id: 'b', importe_centimos: null },
        { nino_id: 'c', importe_centimos: 3000 },
      ],
      false
    )
    expect(p).toEqual({
      ok: true,
      insertar: [
        { nino_id: 'a', importe_centimos: 5000 },
        { nino_id: 'c', importe_centimos: 3000 },
      ],
      actualizar: [],
      borrar: [],
      mover: [],
    })
  })

  it('editar: cambia, añade al becado nuevo, quita y deja el descontado', () => {
    const p = planGuardarCarga(
      [
        tr('t1', 'a', 5000),
        tr('t2', 'b', 5000),
        tr('t3', 'c', 5000),
        tr('t4', 'd', 5000, 'aplicada'),
      ],
      [
        { nino_id: 'a', importe_centimos: 3000 }, // cambia
        { nino_id: 'b', importe_centimos: 3000 }, // cambia al mismo: una sola escritura
        { nino_id: 'c', importe_centimos: null }, // se quita
        { nino_id: 'd', importe_centimos: 5000 }, // descontado, igual
        { nino_id: 'e', importe_centimos: 4000 }, // becado después de la carga
      ],
      false
    )
    expect(p).toEqual({
      ok: true,
      insertar: [{ nino_id: 'e', importe_centimos: 4000 }],
      actualizar: [{ importe_centimos: 3000, ids: ['t1', 't2'] }],
      borrar: ['t3'],
      mover: [],
    })
  })

  it('es idempotente: con la carga ya guardada, nada que escribir', () => {
    const existentes = [tr('t1', 'a', 5000), tr('t2', 'b', 3000, 'aplicada')]
    expect(
      planGuardarCarga(
        existentes,
        [
          { nino_id: 'a', importe_centimos: 5000 },
          { nino_id: 'b', importe_centimos: 3000 },
        ],
        false
      )
    ).toEqual({ ok: true, insertar: [], actualizar: [], borrar: [], mover: [] })
  })

  it('un alumno que no viene en las filas se queda como está', () => {
    const p = planGuardarCarga([tr('t1', 'a', 5000)], [], false)
    expect(p).toEqual({ ok: true, insertar: [], actualizar: [], borrar: [], mover: [] })
  })

  it('cambiar o quitar un tramo descontado: error, sin plan', () => {
    const existentes = [tr('t1', 'a', 5000, 'aplicada')]
    expect(planGuardarCarga(existentes, [{ nino_id: 'a', importe_centimos: 4000 }], false)).toEqual(
      {
        ok: false,
        error: 'carga_aplicada',
      }
    )
    expect(planGuardarCarga(existentes, [{ nino_id: 'a', importe_centimos: null }], false)).toEqual(
      {
        ok: false,
        error: 'carga_aplicada',
      }
    )
  })

  it('cambiar de mes mueve los pendientes que siguen; con alguno descontado, error', () => {
    const p = planGuardarCarga(
      [tr('t1', 'a', 5000), tr('t2', 'b', 5000)],
      [
        { nino_id: 'a', importe_centimos: 5000 },
        { nino_id: 'b', importe_centimos: null },
      ],
      true
    )
    expect(p).toMatchObject({ ok: true, borrar: ['t2'], mover: ['t1'] })
    expect(
      planGuardarCarga([tr('t1', 'a', 5000), tr('t2', 'b', 5000, 'aplicada')], [], true)
    ).toEqual({ ok: false, error: 'carga_aplicada' })
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
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const base = {
    anio_correspondiente: 2026,
    mes_correspondiente: 9,
    anio_aplicacion: 2027,
    mes_aplicacion: 1,
    importes: [
      { nino_id: A, importe_euros: 30 },
      { nino_id: B, importe_euros: null },
    ],
  }
  it('acepta una carga con un importe por alumno; null = sin beca ese mes', () => {
    expect(cargaBecaSchema.safeParse(base).success).toBe(true)
  })
  it('rechaza un importe <= 0', () => {
    for (const importe_euros of [0, -5]) {
      expect(
        cargaBecaSchema.safeParse({ ...base, importes: [{ nino_id: A, importe_euros }] }).success
      ).toBe(false)
    }
  })
  it('rechaza el mismo alumno dos veces', () => {
    const r = cargaBecaSchema.safeParse({
      ...base,
      importes: [
        { nino_id: A, importe_euros: 30 },
        { nino_id: A, importe_euros: 40 },
      ],
    })
    expect(r.success).toBe(false)
  })
  it('rechaza mes fuera de rango y un alumno que no es uuid', () => {
    expect(cargaBecaSchema.safeParse({ ...base, mes_aplicacion: 13 }).success).toBe(false)
    expect(
      cargaBecaSchema.safeParse({ ...base, importes: [{ nino_id: 'x', importe_euros: 3 }] }).success
    ).toBe(false)
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
