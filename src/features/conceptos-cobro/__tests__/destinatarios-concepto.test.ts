import { describe, expect, it } from 'vitest'

import {
  cambiosAsignacion,
  clasesDe,
  conceptoAsignable,
  filtrarDestinatarios,
  type Destinatario,
} from '../lib/destinatarios-concepto'

const ninos: Destinatario[] = [
  { id: 'c', nombre: 'Niño Demo Ángel', aula: 'Pollitos' },
  { id: 'a', nombre: 'Niña Demo Uno', aula: 'Ositos' },
  { id: 'b', nombre: 'Niño Demo Dos', aula: 'Pollitos' },
  { id: 'd', nombre: 'Niño Demo Sin Clase', aula: null },
]

describe('cambiosAsignacion', () => {
  it('solo manda lo que cambia, ordenado', () => {
    const inicial = new Set(['a', 'b'])
    const actual = new Set(['b', 'c'])
    expect(cambiosAsignacion(inicial, actual)).toEqual([
      { id: 'a', asignada: false },
      { id: 'c', asignada: true },
    ])
  })

  it('sin cambios, lista vacía (no se puede guardar)', () => {
    expect(cambiosAsignacion(new Set(['a']), new Set(['a']))).toEqual([])
  })
})

describe('filtrarDestinatarios', () => {
  it('por clase', () => {
    expect(filtrarDestinatarios(ninos, 'Pollitos', '').map((n) => n.id)).toEqual(['c', 'b'])
  })

  it('por nombre, sin distinguir acentos ni mayúsculas', () => {
    expect(filtrarDestinatarios(ninos, null, 'angel').map((n) => n.id)).toEqual(['c'])
  })

  it('sin filtros, todos', () => {
    expect(filtrarDestinatarios(ninos, null, '  ')).toHaveLength(4)
  })
})

describe('clasesDe', () => {
  it('sin repetir, sin la clase vacía y en orden', () => {
    expect(clasesDe(ninos)).toEqual(['Ositos', 'Pollitos'])
  })
})

describe('conceptoAsignable', () => {
  it('los mismos que ofrece Asignación permanente: activos y manuales', () => {
    expect(conceptoAsignable({ activo: true, aplicacion: 'manual' })).toBe(true)
    expect(conceptoAsignable({ activo: false, aplicacion: 'manual' })).toBe(false)
    expect(conceptoAsignable({ activo: true, aplicacion: 'automatico' })).toBe(false)
  })
})
