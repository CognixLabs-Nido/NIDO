// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * El día de calendario en Madrid se saca en los tests con `hoyMadrid()` y `offsetDias()` de
 * `agenda-diaria/lib/fecha`, nunca con un formateador propio. Los tests que se hacían el suyo
 * restaban 24 h a «ahora» para sacar ayer, y el día del cambio de hora (23 o 25 horas) eso cae en
 * el día equivocado: dos veces al año la CI de RLS salía roja sin motivo (PR-14 y #422, el
 * 2026-10-25). Un formateador `Europe/Madrid` en un test es el primer paso de esa fórmula: si hace
 * falta otro, se añade aquí con su motivo.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const RE_FORMATEADOR_MADRID = /timeZone:\s*['"`]Europe\/Madrid['"`]/
const PERMITIDOS: Record<string, string> = {
  'src/features/agenda-diaria/lib/__tests__/fecha.test.ts':
    'prueba el helper: reproduce la fórmula vieja para demostrar que falla en el cambio de hora',
  'src/test/guards/dia-madrid-en-tests.test.ts':
    'este guard: los casos con que se comprueba el patrón',
}

function esTest(rel: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(rel) || rel.startsWith('src/test/')
}

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    if (n === 'node_modules') return []
    return statSync(p).isDirectory() ? ficheros(p) : [p]
  })
}

function conFormateadorPropio(): string[] {
  return ['src', 'e2e']
    .flatMap((d) => ficheros(path.join(RAIZ, d)))
    .map((p) => path.relative(RAIZ, p).split(path.sep).join('/'))
    .filter((rel) => /\.tsx?$/.test(rel) && esTest(rel))
    .filter((rel) => RE_FORMATEADOR_MADRID.test(readFileSync(path.join(RAIZ, rel), 'utf8')))
}

describe('tests: el día de Madrid sale del helper, no de un formateador propio', () => {
  it('ningún test formatea en Europe/Madrid por su cuenta, salvo los permitidos', () => {
    const encontrados = conFormateadorPropio()
    // Premisa: el censo encuentra el permitido (el patrón caza y el árbol se recorre).
    expect(encontrados).toContain('src/features/agenda-diaria/lib/__tests__/fecha.test.ts')
    expect(encontrados.filter((rel) => !(rel in PERMITIDOS))).toEqual([])
  })

  it('el patrón caza el formateador de los helpers viejos y no el nombre del huso en un comentario', () => {
    expect(
      RE_FORMATEADOR_MADRID.test(
        "new Intl.DateTimeFormat('en-CA', {\n    timeZone: 'Europe/Madrid',\n    year: 'numeric',"
      )
    ).toBe(true)
    expect(
      RE_FORMATEADOR_MADRID.test('Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Madrid" })')
    ).toBe(true)
    expect(
      RE_FORMATEADOR_MADRID.test(' * Devuelve true si la fecha es hoy en huso Europe/Madrid.')
    ).toBe(false)
  })
})
