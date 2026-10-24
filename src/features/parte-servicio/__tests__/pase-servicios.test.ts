import { describe, expect, it } from 'vitest'

import {
  SERVICIOS_DEL_DIA,
  cambiosPase,
  casilla,
  clasesDe,
  combinarPase,
  filtrarFilas,
  type AlumnoListado,
} from '../lib/pase-servicios'
import { servicioDiarioEnum } from '../schemas/parte-servicio'

const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const C = 'c0000000-0000-4000-8000-000000000003'

const LISTADO: AlumnoListado[] = [
  { nino_id: A, nombre: 'Ana', apellidos: 'Demo Uno', aula_id: 'aula-1', aula_nombre: 'Patitos' },
  { nino_id: B, nombre: 'Íñigo', apellidos: 'Demo Dos', aula_id: 'aula-1', aula_nombre: 'Patitos' },
  { nino_id: C, nombre: 'Carla', apellidos: 'Demo Tres', aula_id: 'aula-2', aula_nombre: 'Ositos' },
]

describe('SERVICIOS_DEL_DIA', () => {
  it('son los tres del enum, en el orden del día: mañana, comedor, tarde', () => {
    expect([...SERVICIOS_DEL_DIA]).toEqual(['matinera', 'comedor', 'vespertina'])
    expect([...SERVICIOS_DEL_DIA].sort()).toEqual([...servicioDiarioEnum.options].sort())
  })
})

describe('combinarPase', () => {
  it('cada niño con lo apuntado; lo no apuntado es null; conserva el orden del listado', () => {
    const filas = combinarPase(LISTADO, [
      { nino_id: A, servicio: 'comedor', presente: true },
      { nino_id: C, servicio: 'matinera', presente: false },
    ])
    expect(filas.map((f) => f.ninoId)).toEqual([A, B, C])
    expect(filas[0]?.servicios).toEqual({ matinera: null, comedor: true, vespertina: null })
    expect(filas[1]?.servicios).toEqual({ matinera: null, comedor: null, vespertina: null })
    expect(filas[2]?.servicios).toEqual({ matinera: false, comedor: null, vespertina: null })
  })

  it('un parte de un niño que no está en el listado no añade filas', () => {
    const filas = combinarPase(LISTADO.slice(0, 1), [
      { nino_id: C, servicio: 'comedor', presente: true },
    ])
    expect(filas).toHaveLength(1)
  })
})

describe('cambiosPase', () => {
  const filas = combinarPase(LISTADO, [
    { nino_id: A, servicio: 'comedor', presente: true },
    { nino_id: B, servicio: 'comedor', presente: false },
  ])

  it('premisa: sin tocar nada no hay nada que guardar', () => {
    expect(cambiosPase(filas, {})).toEqual([])
  })

  it('marcar una casilla sin apuntar se guarda como presente', () => {
    expect(cambiosPase(filas, { [casilla(C, 'vespertina')]: true })).toEqual([
      { nino_id: C, servicio: 'vespertina', presente: true },
    ])
  })

  it('desmarcar una casilla apuntada se guarda como no presente (deja de cobrarse)', () => {
    expect(cambiosPase(filas, { [casilla(A, 'comedor')]: false })).toEqual([
      { nino_id: A, servicio: 'comedor', presente: false },
    ])
  })

  it('volver al valor guardado no es un cambio', () => {
    expect(
      cambiosPase(filas, { [casilla(A, 'comedor')]: true, [casilla(B, 'comedor')]: false })
    ).toEqual([])
  })

  it('desmarcar lo que nunca se apuntó no es un cambio: en pantalla, null y no se ven igual', () => {
    expect(cambiosPase(filas, { [casilla(C, 'matinera')]: false })).toEqual([])
  })

  it('junta los tres servicios de varios niños en un solo guardado', () => {
    const r = cambiosPase(filas, {
      [casilla(A, 'matinera')]: true,
      [casilla(B, 'comedor')]: true,
      [casilla(C, 'vespertina')]: true,
    })
    expect(r).toHaveLength(3)
    expect(new Set(r.map((i) => i.servicio))).toEqual(
      new Set(['matinera', 'comedor', 'vespertina'])
    )
  })
})

describe('filtrarFilas y clasesDe', () => {
  const filas = combinarPase(LISTADO, [])

  it('las clases en su orden, sin repetir', () => {
    expect(clasesDe(filas)).toEqual([
      { id: 'aula-1', nombre: 'Patitos' },
      { id: 'aula-2', nombre: 'Ositos' },
    ])
  })

  it('sin filtro, todos: el listado es de todo el centro', () => {
    expect(filtrarFilas(filas, null, '')).toHaveLength(3)
  })

  it('por clase', () => {
    expect(filtrarFilas(filas, 'aula-2', '').map((f) => f.ninoId)).toEqual([C])
  })

  it('por nombre o apellidos, sin distinguir tildes ni mayúsculas', () => {
    expect(filtrarFilas(filas, null, 'inigo').map((f) => f.ninoId)).toEqual([B])
    expect(filtrarFilas(filas, null, 'TRES').map((f) => f.ninoId)).toEqual([C])
    expect(filtrarFilas(filas, 'aula-1', 'tres')).toEqual([])
  })
})
