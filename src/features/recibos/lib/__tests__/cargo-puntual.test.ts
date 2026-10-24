import { describe, expect, it } from 'vitest'

import {
  agruparPorAula,
  alternarGrupo,
  cargoPuntualSchema,
  importeCargo,
  marcaGrupo,
  resumirCargo,
  type FilaCargo,
  type NinoCargo,
} from '../cargo-puntual'

/**
 * PR-13 — cargo puntual a varios niños. La elección por clase, el importe tecleado y el resumen
 * que se le enseña a Dirección a partir de lo que devuelve `anadir_cargo_puntual`.
 */

const CENTRO = '11111111-1111-4111-8111-111111111111'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const NINOS: NinoCargo[] = [
  { id: id(1), nombre: 'Zoe Demo', aula: 'Patitos' },
  { id: id(2), nombre: 'Álex Demo', aula: 'Patitos' },
  { id: id(3), nombre: 'Bea Demo', aula: null },
  { id: id(4), nombre: 'Carla Demo', aula: 'Conejitos' },
]

describe('agruparPorAula', () => {
  it('agrupa por clase en orden alfabético, con los niños sin clase al final', () => {
    const g = agruparPorAula(NINOS)
    expect(g.map((x) => x.aula)).toEqual(['Conejitos', 'Patitos', null])
    // Dentro de la clase, por nombre, sin que la tilde mande al final.
    expect(g[1]!.ninos.map((n) => n.nombre)).toEqual(['Álex Demo', 'Zoe Demo'])
  })

  it('sin niños, sin grupos', () => {
    expect(agruparPorAula([])).toEqual([])
  })
})

describe('marcaGrupo y alternarGrupo', () => {
  const patitos = agruparPorAula(NINOS)[1]!

  it('marca todos, algunos o ninguno', () => {
    expect(marcaGrupo(patitos, new Set())).toBe('ninguno')
    expect(marcaGrupo(patitos, new Set([id(1)]))).toBe('algunos')
    expect(marcaGrupo(patitos, new Set([id(1), id(2), id(4)]))).toBe('todos')
  })

  it('elegir la clase entera no toca a los niños de otras clases, y quitarla tampoco', () => {
    const conCarla = new Set([id(4)])
    const elegida = alternarGrupo(patitos, conCarla, true)
    expect([...elegida].sort()).toEqual([id(1), id(2), id(4)])
    expect([...conCarla]).toEqual([id(4)]) // no muta la de entrada
    expect([...alternarGrupo(patitos, elegida, false)]).toEqual([id(4)])
  })
})

describe('importeCargo', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    [' 0,01 ', 1],
    ['100000', 100_000_00],
  ])('«%s» son %i céntimos', (texto, centimos) => {
    expect(importeCargo(texto)).toBe(centimos)
  })

  it.each(['', '0', '0,00', '-5', '12,345', '1e3', 'abc', '100000,01', '1.000,00'])(
    '«%s» no es un cargo',
    (texto) => {
      expect(importeCargo(texto)).toBeNull()
    }
  )
})

describe('cargoPuntualSchema', () => {
  const valido = {
    centroId: CENTRO,
    anio: 2026,
    mes: 11,
    ninoIds: [id(1), id(2)],
    descripcion: '  Excursión a la granja ',
    importeCentimos: 1200,
  }

  it('acepta un cargo y recorta la descripción', () => {
    const r = cargoPuntualSchema.safeParse(valido)
    expect(r.success && r.data.descripcion).toBe('Excursión a la granja')
  })

  it.each([
    ['sin niños', { ninoIds: [] }, 'cargo_puntual.errors.sin_ninos'],
    ['sin descripción', { descripcion: '   ' }, 'cargo_puntual.errors.sin_descripcion'],
    ['importe 0', { importeCentimos: 0 }, 'cargo_puntual.errors.importe_invalido'],
    ['importe negativo', { importeCentimos: -100 }, 'cargo_puntual.errors.importe_invalido'],
    ['importe de más', { importeCentimos: 100_000_01 }, 'cargo_puntual.errors.importe_invalido'],
  ])('rechaza %s con su motivo', (_, cambio, motivo) => {
    const r = cargoPuntualSchema.safeParse({ ...valido, ...cambio })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe(motivo)
  })

  it('rechaza un niño repetido y un mes fuera de rango', () => {
    expect(cargoPuntualSchema.safeParse({ ...valido, ninoIds: [id(1), id(1)] }).success).toBe(false)
    expect(cargoPuntualSchema.safeParse({ ...valido, mes: 13 }).success).toBe(false)
  })
})

describe('resumirCargo', () => {
  const nombres = new Map(NINOS.map((n) => [n.id, n.nombre]))
  const fila = (
    nino: number,
    familia: number,
    resultado: FilaCargo['resultado'],
    estado: FilaCargo['estado'] = 'borrador'
  ): FilaCargo => ({
    nino_id: id(nino),
    familia_id: id(100 + familia),
    familia_etiqueta: `Familia ${familia}`,
    recibo_id: id(200 + familia),
    resultado,
    estado,
  })

  it('cuenta niños y familias, y aparta lo que ya estaba y lo validado', () => {
    const r = resumirCargo(
      [
        // Dos hermanos en la misma familia, que cuenta una vez.
        fila(1, 1, 'incluido'),
        fila(2, 1, 'incluido'),
        fila(3, 2, 'recibo_nuevo'),
        fila(4, 3, 'ya_incluido'),
        fila(9, 4, 'no_incluido', 'pendiente_procesar'),
      ],
      nombres
    )
    expect(r).toEqual({
      incluidos: 3,
      familias: 2,
      recibosNuevos: 1,
      yaIncluidos: ['Carla Demo'],
      // Un id sin nombre sale tal cual, no desaparece.
      noIncluidas: [{ familia: 'Familia 4', estado: 'pendiente_procesar', ninos: [id(9)] }],
    })
  })

  it('agrupa por familia a los hermanos no incluidos, en orden', () => {
    const r = resumirCargo(
      [
        fila(2, 7, 'no_incluido', 'enviado_banco'),
        fila(1, 7, 'no_incluido', 'enviado_banco'),
        fila(3, 5, 'no_incluido', 'cobrado_manual'),
      ],
      nombres
    )
    expect(r.incluidos).toBe(0)
    expect(r.noIncluidas).toEqual([
      { familia: 'Familia 5', estado: 'cobrado_manual', ninos: ['Bea Demo'] },
      { familia: 'Familia 7', estado: 'enviado_banco', ninos: ['Álex Demo', 'Zoe Demo'] },
    ])
  })
})
