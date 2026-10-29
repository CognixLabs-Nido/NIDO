// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { hoyMadrid, offsetDias } from '@/features/agenda-diaria/lib/fecha'

import { cursoDeTest } from '../rls/curso-de-test'

/**
 * El curso de los fixtures sale de un cálculo, no de un literal (PR-C). Este centinela simula los
 * días en los que un literal se habría quedado atrás, en vez de esperar a que lleguen: el 1 de
 * agosto de 2027 (el día después del final del literal viejo), el 31 de julio a medianoche en
 * Madrid, el 1 de septiembre y el 31 de diciembre. En cada uno, el curso calculado contiene el día.
 * Y los ficheros que copiaban el literal ya no llevan ninguna fecha escrita a mano del curso.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const FICHEROS_DEL_CURSO = [
  'src/test/rls/setup.ts',
  'src/test/rls/cerrar-curso.rls.test.ts',
  'src/test/rls/beca-panel.rls.test.ts',
  'src/test/rls/matriculas-motivo-baja-columna.rls.test.ts',
]
// Una fecha escrita a mano. Las de nacimiento no son del curso.
const RE_FECHA = /'\d{4}-\d{2}-\d{2}'/

function fechasEscritas(texto: string): string[] {
  return texto.split('\n').filter((l) => RE_FECHA.test(l) && !l.includes('fecha_nacimiento'))
}

afterEach(() => {
  vi.useRealTimers()
})

function a(instante: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instante))
}

describe('el curso de los fixtures se calcula desde hoy', () => {
  it('premisa: el reloj simulado mueve el día de Madrid', () => {
    a('2027-07-31T22:30:00Z')
    expect(hoyMadrid()).toBe('2027-08-01')
  })

  it.each([
    [
      '1 de agosto de 2027, el día después del literal viejo',
      '2027-07-31T22:30:00Z',
      '2027-08-01',
      '2026-09-01',
      '2027-08-31',
    ],
    [
      '31 de julio de 2027 a las 23:59 en Madrid',
      '2027-07-31T21:59:00Z',
      '2027-07-31',
      '2026-09-01',
      '2027-08-31',
    ],
    [
      '1 de septiembre de 2027 a medianoche en Madrid',
      '2027-08-31T22:00:00Z',
      '2027-09-01',
      '2027-09-01',
      '2028-08-31',
    ],
    [
      '31 de diciembre de 2027 a las 23:30 en Madrid',
      '2027-12-31T22:30:00Z',
      '2027-12-31',
      '2027-09-01',
      '2028-08-31',
    ],
  ])('%s: el curso contiene el día', (_caso, instante, dia, inicio, fin) => {
    a(instante)
    expect(hoyMadrid()).toBe(dia)
    const curso = cursoDeTest()
    expect(curso).toEqual({ inicio, fin })
    expect(curso.inicio <= dia && dia <= curso.fin).toBe(true)
  })

  it('cualquier día de cuatro años cae dentro, y los cursos vecinos van seguidos', () => {
    let dias = 0
    for (let dia = '2026-01-01'; dia <= '2029-12-31'; dia = offsetDias(dia, 1)) {
      const curso = cursoDeTest(dia)
      expect(curso.inicio <= dia && dia <= curso.fin, dia).toBe(true)
      expect(offsetDias(cursoDeTest(dia, -1).fin, 1), dia).toBe(curso.inicio)
      expect(offsetDias(curso.fin, 1), dia).toBe(cursoDeTest(dia, 1).inicio)
      dias++
    }
    expect(dias).toBe(1461)
  })
})

describe('los ficheros que copiaban el curso no llevan fechas escritas a mano', () => {
  it('el patrón caza el literal viejo y no la fecha de nacimiento', () => {
    expect(fechasEscritas("      fecha_fin: '2027-07-31',")).toHaveLength(1)
    expect(fechasEscritas("const ALTA = '2026-09-01' // = createTestCurso")).toHaveLength(1)
    expect(fechasEscritas("        fecha_nacimiento: '2024-03-15',")).toHaveLength(0)
  })

  it.each(FICHEROS_DEL_CURSO)('%s', (rel) => {
    expect(fechasEscritas(readFileSync(path.join(RAIZ, rel), 'utf8'))).toEqual([])
  })
})
