import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { VALORES_CONOCIDOS } from '@/features/export/lib/render-html'
import { COMO_NOS_CONOCIO } from '@/features/ninos/schemas/nino'

/**
 * «Cómo nos has conocido» (fase 5b): los códigos son los mismos en la base, en la app, en la
 * exportación y en la pantalla. Se LEEN de cada sitio (el CHECK de la última migración que lo
 * define, el enum de la app, el diccionario del export y los mensajes): un código nuevo en un sitio
 * y no en otro se pone rojo solo. Hasta la 5b, cuatro de los cinco salían en castellano en la
 * exportación en inglés y en valenciano.
 */
const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const conCheck = readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) =>
    readFileSync(join(MIGRACIONES, f), 'utf8').includes('CONSTRAINT ninos_como_nos_conocio')
  )
const ultima = readFileSync(join(MIGRACIONES, conCheck.at(-1)!), 'utf8')
const check = ultima.slice(ultima.indexOf('CONSTRAINT ninos_como_nos_conocio'))
const enLaBase = new Set([
  ...[...check.slice(0, check.indexOf(')),')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!),
])

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]
const hoja = (o: unknown, ruta: string): unknown =>
  ruta
    .split('.')
    .reduce<unknown>(
      (x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined),
      o
    )

describe('«cómo nos has conocido»: los mismos códigos en todas partes', () => {
  it('premisa: se leen los códigos del CHECK de la base', () => {
    expect(conCheck.length).toBeGreaterThan(0)
    expect(enLaBase.size).toBeGreaterThanOrEqual(5)
    expect(enLaBase).toContain('otro')
  })

  it('la app y la base tienen los mismos códigos', () => {
    expect([...COMO_NOS_CONOCIO].sort()).toEqual([...enLaBase].sort())
  })

  it('la exportación los traduce todos (no los «humaniza» en castellano)', () => {
    for (const c of COMO_NOS_CONOCIO) expect.soft(VALORES_CONOCIDOS.has(c), c).toBe(true)
  })

  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: cada código tiene su texto en el export y en la pantalla del alta`, () => {
      for (const c of COMO_NOS_CONOCIO) {
        for (const ruta of [
          `export.doc.valores.${c}`,
          `alta.menor.como_nos_conocio_opciones.${c}`,
        ]) {
          const v = hoja(msgs, ruta)
          expect.soft(typeof v, `${locale}: ${ruta}`).toBe('string')
          expect.soft(String(v ?? '').trim(), `${locale}: ${ruta}`).not.toBe('')
        }
      }
    })
  }
})
