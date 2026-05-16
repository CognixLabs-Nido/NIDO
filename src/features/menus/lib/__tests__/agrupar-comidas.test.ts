import { describe, expect, it } from 'vitest'

import { agruparComidasPorMomento, type ComidaAgrupable } from '../agrupar-comidas'

function row(overrides: Partial<ComidaAgrupable>): ComidaAgrupable {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    momento: overrides.momento ?? 'comida',
    hora: overrides.hora ?? null,
    cantidad: overrides.cantidad ?? 'todo',
    descripcion: overrides.descripcion ?? null,
    observaciones: overrides.observaciones ?? null,
    tipo_plato: overrides.tipo_plato,
    menu_dia_id: overrides.menu_dia_id,
  }
}

describe('agruparComidasPorMomento', () => {
  it('una fila F3 legacy (tipo_plato=null) va a filasGenericas', () => {
    const out = agruparComidasPorMomento([
      row({ momento: 'comida', cantidad: 'todo', descripcion: 'Lentejas', tipo_plato: null }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].momento).toBe('comida')
    expect(out[0].filasGenericas).toHaveLength(1)
    expect(out[0].platos).toHaveLength(0)
  })

  it('una fila F3 sin tipo_plato (undefined) también va a filasGenericas', () => {
    const c: ComidaAgrupable = {
      id: 'x',
      momento: 'desayuno',
      hora: '08:30',
      cantidad: 'mitad',
      descripcion: 'Galletas',
      observaciones: null,
      // tipo_plato y menu_dia_id ausentes (legacy F3)
    }
    const out = agruparComidasPorMomento([c])
    expect(out[0].filasGenericas).toHaveLength(1)
    expect(out[0].platos).toHaveLength(0)
  })

  it('3 filas F4.5b con tipo_plato no nulo → desglose por platos en orden', () => {
    const out = agruparComidasPorMomento([
      row({ momento: 'comida', tipo_plato: 'postre', descripcion: 'Yogur' }),
      row({ momento: 'comida', tipo_plato: 'primer_plato', descripcion: 'Macarrones' }),
      row({ momento: 'comida', tipo_plato: 'segundo_plato', descripcion: 'Pollo' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].platos).toHaveLength(3)
    expect(out[0].filasGenericas).toHaveLength(0)
    // Orden fijo: primer_plato → segundo_plato → postre.
    expect(out[0].platos.map((p) => p.tipo_plato)).toEqual([
      'primer_plato',
      'segundo_plato',
      'postre',
    ])
  })

  it('mezcla legacy + nuevo: ambas filas coexisten en el mismo momento', () => {
    const out = agruparComidasPorMomento([
      row({ momento: 'comida', tipo_plato: null, descripcion: 'Plato genérico legacy' }),
      row({ momento: 'comida', tipo_plato: 'primer_plato', descripcion: 'Macarrones' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].filasGenericas).toHaveLength(1)
    expect(out[0].platos).toHaveLength(1)
  })

  it('momentos ordenados: desayuno → media_manana → comida → merienda', () => {
    const out = agruparComidasPorMomento([
      row({ momento: 'merienda', tipo_plato: 'unico' }),
      row({ momento: 'desayuno', tipo_plato: 'unico' }),
      row({ momento: 'comida', tipo_plato: 'primer_plato' }),
      row({ momento: 'media_manana', tipo_plato: 'unico' }),
    ])
    expect(out.map((g) => g.momento)).toEqual(['desayuno', 'media_manana', 'comida', 'merienda'])
  })

  it('tipo_plato="unico" cae en platos (no en filasGenericas)', () => {
    const out = agruparComidasPorMomento([
      row({ momento: 'desayuno', tipo_plato: 'unico', descripcion: 'Tostadas' }),
    ])
    expect(out[0].filasGenericas).toHaveLength(0)
    expect(out[0].platos).toHaveLength(1)
    expect(out[0].platos[0].tipo_plato).toBe('unico')
  })

  it('lista vacía → array vacío', () => {
    expect(agruparComidasPorMomento([])).toEqual([])
  })
})
