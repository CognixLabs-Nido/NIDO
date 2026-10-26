import { describe, expect, it } from 'vitest'

import { clasesDe, filtrarNinos } from '../filtrar-ninos'

const ninos = [
  { id: 'c', nombre: 'Niño Demo Ángel', aula: 'Pollitos' },
  { id: 'a', nombre: 'Niña Demo Uno', aula: 'Ositos' },
  { id: 'b', nombre: 'Niño Demo Dos', aula: 'Pollitos' },
  { id: 'd', nombre: 'Niño Demo Sin Clase', aula: null },
]

describe('filtrarNinos', () => {
  it('por clase', () => {
    expect(filtrarNinos(ninos, 'Pollitos', '').map((n) => n.id)).toEqual(['c', 'b'])
  })

  it('por nombre, sin distinguir acentos ni mayúsculas', () => {
    expect(filtrarNinos(ninos, null, 'angel').map((n) => n.id)).toEqual(['c'])
  })

  it('clase y nombre a la vez', () => {
    expect(filtrarNinos(ninos, 'Pollitos', 'dos').map((n) => n.id)).toEqual(['b'])
  })

  it('sin filtros, todos', () => {
    expect(filtrarNinos(ninos, null, '  ')).toHaveLength(4)
  })
})

describe('clasesDe', () => {
  it('sin repetir, sin la clase vacía y en orden', () => {
    expect(clasesDe(ninos)).toEqual(['Ositos', 'Pollitos'])
  })
})
