import { describe, expect, it } from 'vitest'

import {
  agruparPorCurso,
  contarFirmas,
  cursosParaSubir,
  leerListaAdmin,
  sePuedeCambiarDeCurso,
  sePuedeOfrecerBorrar,
  type CursoDeLaPantalla,
  type VersionAdmin,
} from '../pantalla'

/** Fixtures ficticios del 2026-11-05: el presupuesto de dos cursos vivos a la vez. */
const C2627: CursoDeLaPantalla = { id: 'c-2026', nombre: '2026/27', estado: 'activo' }
const C2728: CursoDeLaPantalla = { id: 'c-2027', nombre: '2027/28', estado: 'planificado' }
const C2526: CursoDeLaPantalla = { id: 'c-2025', nombre: '2025/26', estado: 'cerrado' }
// En el orden en que llegan de la base: por fecha de inicio, la más reciente primero.
const CURSOS = [C2728, C2627, C2526]

function v(id: string, curso: string | null, numero: number, vigente: boolean): VersionAdmin {
  return {
    id,
    curso_academico_id: curso,
    numero,
    sha256: id.padEnd(64, '0'),
    bytes: 1000,
    subida_at: '2026-11-05T10:00:00Z',
    vigente,
  }
}

describe('agruparPorCurso: varias vivas a la vez, una por curso', () => {
  it('cada curso con lo suyo, del curso más reciente al más antiguo, y dentro de mayor a menor', () => {
    const grupos = agruparPorCurso(
      [v('a', 'c-2026', 1, false), v('b', 'c-2027', 1, true), v('c', 'c-2026', 2, true)],
      CURSOS
    )
    expect(grupos.map((g) => [g.cursoNombre, g.versiones.map((x) => x.id)])).toEqual([
      ['2027/28', ['b']],
      ['2026/27', ['c', 'a']],
    ])
    // Las dos vigentes se ven a la vez: la de cada curso.
    expect(grupos.flatMap((g) => g.versiones.filter((x) => x.vigente).map((x) => x.id))).toEqual([
      'b',
      'c',
    ])
  })

  it('sin curso (un documento que no es de curso) es un grupo, sin nombre', () => {
    const grupos = agruparPorCurso([v('n1', null, 1, false), v('n2', null, 2, true)], CURSOS)
    expect(grupos).toHaveLength(1)
    expect([grupos[0].cursoId, grupos[0].cursoNombre]).toEqual([null, null])
    expect(grupos[0].versiones.map((x) => x.numero)).toEqual([2, 1])
  })

  it('un curso que ya no está en la lista sale al final, sin nombre, no se pierde', () => {
    const grupos = agruparPorCurso([v('x', 'c-borrado', 1, true), v('y', 'c-2026', 1, true)], CURSOS)
    expect(grupos.map((g) => [g.cursoId, g.cursoNombre])).toEqual([
      ['c-2026', '2026/27'],
      ['c-borrado', null],
    ])
  })
})

describe('lo que la pantalla ofrece', () => {
  it('borrar, solo con cero firmas (J5)', () => {
    const firmas = contarFirmas([{ version_id: 'a' }, { version_id: 'a' }, { version_id: 'b' }])
    expect(firmas).toEqual({ a: 2, b: 1 })
    expect([
      sePuedeOfrecerBorrar(firmas, 'a'),
      sePuedeOfrecerBorrar(firmas, 'b'),
      sePuedeOfrecerBorrar(firmas, 'c'),
    ]).toEqual([false, false, true])
  })

  it('cambiar «de curso», solo sin versiones (J6)', () => {
    expect(sePuedeCambiarDeCurso({ versiones: [] })).toBe(true)
    expect(sePuedeCambiarDeCurso({ versiones: [v('a', null, 1, true)] })).toBe(false)
  })

  it('subir, a un curso planificado o activo, nunca cerrado', () => {
    expect(cursosParaSubir(CURSOS).map((c) => c.id)).toEqual(['c-2027', 'c-2026'])
  })
})

describe('leerListaAdmin', () => {
  it('lo que no es una lista sale como lista vacía, y lo que sí, tal cual', () => {
    expect(leerListaAdmin(null)).toEqual({ documentos: [], ficheros_sueltos: [] })
    expect(leerListaAdmin({ documentos: 'x', ficheros_sueltos: 3 })).toEqual({
      documentos: [],
      ficheros_sueltos: [],
    })
    expect(leerListaAdmin({ documentos: [], ficheros_sueltos: ['a/b/c.pdf'] })).toEqual({
      documentos: [],
      ficheros_sueltos: ['a/b/c.pdf'],
    })
  })
})
