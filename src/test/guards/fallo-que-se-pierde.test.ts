// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const escaner = require('../../../scripts/ci/fallo-que-se-pierde.cjs')
const { analizar, comprobar } = escaner

/**
 * El escáner del fallo que se pierde (censo C, decisiones de Jose del 2026-11-26), como paso de la CI: sus
 * casos, con la respuesta escrita ANTES de correrlo, sobre un árbol de mentira. Decide por el TIPO
 * (`PostgrestError`, los constructores de PostgREST), así que el árbol vive dentro de `node_modules/.cache` y
 * resuelve `@supabase/supabase-js` del repo. Si deja de ver un helper de la clase, o un llamador que no mira,
 * esto se pone rojo. Y `comprobar` (la puerta de la CI): lo nuevo y lo que sobra en la lista, los dos rojos.
 */
const RAIZ = path.resolve(__dirname, '..', '..', '..')
let dir = ''

const FUENTE = `
import type { SupabaseClient } from '@supabase/supabase-js'
declare const db: SupabaseClient

// Clase 2: el helper devuelve el constructor; el error viaja a quien lo llama.
export function consulta() {
  return db.from('t').select('id')
}
export async function mira() {
  const { data, error } = await consulta()
  if (error) throw error
  return data
}
export async function noMira() {
  const { data } = await consulta()
  return data
}

// Clase 1: el helper avisa del fallo con null; el llamador puede mirarlo o no.
export async function esNueva(): Promise<boolean | null> {
  const { data, error } = await db.from('t').select('id')
  if (error) return null
  return (data ?? []).length === 0
}
export async function usa() {
  const n = await esNueva()
  if (n === null) throw new Error('no se pudo leer')
  return n
}
export async function noUsa() {
  const n = await esNueva()
  return n === true
}
`
// La respuesta, escrita antes de correrlo.
const CLASE2 = { mira: 'MIRA', noMira: 'NO_MIRA' }
const CLASE1 = { usa: 'USA', noUsa: 'NO_USA' }

let r: {
  sitios: Array<{ donde: string; clase: string; helper: string }>
  clase1: { sitios: Array<{ donde: string; clase: string; helper: string }> }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(RAIZ, 'node_modules', '.cache', 'fallo-que-se-pierde-'))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'casos.ts'), FUENTE)
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['src/**/*.ts'],
    })
  )
  r = analizar(dir)
}, 120_000)

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

/** La función que contiene la línea de un sitio, leída del propio fuente. */
function funcionDe(donde: string): string {
  const linea = Number(donde.split(':').pop())
  const lineas = FUENTE.split('\n')
  for (let i = linea - 1; i >= 0; i--) {
    const m = /export (?:async )?function (\w+)/.exec(lineas[i] ?? '')
    if (m) return m[1]!
  }
  return '?'
}

describe('fallo-que-se-pierde: el escáner', () => {
  it('clase 2: el que mira y el que no', () => {
    const porFuncion = Object.fromEntries(r.sitios.map((s) => [funcionDe(s.donde), s.clase]))
    expect(porFuncion).toEqual(CLASE2)
  })

  it('clase 1: el que usa el aviso y el que no', () => {
    const porFuncion = Object.fromEntries(r.clase1.sitios.map((s) => [funcionDe(s.donde), s.clase]))
    expect(porFuncion).toEqual(CLASE1)
  })
})

describe('fallo-que-se-pierde: la puerta de la CI (comprobar)', () => {
  // `donde` es `fichero:línea` con la línea entera, como lo da el escáner.
  let linea = 0
  const sitio = (clase: string, helper = 'h') => ({
    donde: `src/a.ts:${++linea}`,
    clase,
    helper,
  })
  const informe = (sitios: Array<{ donde: string; clase: string; helper: string }>) => ({
    sitios,
    clase1: { sitios: [] },
  })

  it('premisa: lo que está en la lista, con su número, pasa; MIRA y PASA no cuentan', () => {
    const lista = { 'src/a.ts|h|NO_MIRA': { n: 2, motivo: 'x' } }
    expect(
      comprobar(informe([sitio('NO_MIRA'), sitio('NO_MIRA'), sitio('MIRA'), sitio('PASA')]), lista)
    ).toEqual({ nuevas: [], sobran: [] })
  })

  it('uno más de los que admite: nuevo, rojo', () => {
    const lista = { 'src/a.ts|h|NO_MIRA': { n: 1, motivo: 'x' } }
    expect(comprobar(informe([sitio('NO_MIRA'), sitio('NO_MIRA')]), lista).nuevas).toHaveLength(1)
  })

  it('fuera de la lista: nuevo, rojo', () => {
    expect(comprobar(informe([sitio('NO_USA', 'otro')]), {}).nuevas).toEqual([
      { clave: 'src/a.ts|otro|NO_USA', hay: 1, admite: 0 },
    ])
  })

  it('uno menos de los que admite: sobra, rojo (la lista solo encoge)', () => {
    const lista = { 'src/a.ts|h|NO_MIRA': { n: 2, motivo: 'x' } }
    expect(comprobar(informe([sitio('NO_MIRA')]), lista).sobran).toEqual([
      { clave: 'src/a.ts|h|NO_MIRA', hay: 1, admite: 2 },
    ])
  })
})
