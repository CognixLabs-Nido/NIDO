import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Claves de error ABSOLUTAS que viajan del servidor a la pantalla: `fail('…')`, `fail(`${E}.x`)`,
 * el `?? '…'` de respaldo tras `issues[0]?.message`, `error: '…'` / `errorKey: '…'` y los mensajes
 * de zod de `schemas/`. La pantalla las pinta con `t(r.error)` —casi siempre en un toast— y
 * next-intl, con una clave ausente, enseña la clave en crudo («citas.validation.sin_invitados»).
 * Se LEEN del código, no se enumeran: un `fail` nuevo sin traducir se pone rojo solo.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

// Literales con forma de clave que no son claves: el nombre de un método.
const NO_SON_CLAVES = new Set(['logger.error'])

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'test' ? [] : ficheros(p)
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

const K = String.raw`([a-zA-Z]\w*(?:\.\w+)+)`
const DONDE = new Map<string, string>()
for (const f of ficheros(join(process.cwd(), 'src'))) {
  const src = readFileSync(f, 'utf8')
  const rel = relative(process.cwd(), f)
  const pats = [
    new RegExp(String.raw`\bfail\(\s*'${K}'`, 'g'),
    new RegExp(String.raw`\?\?\s*'${K}'`, 'g'),
    new RegExp(String.raw`\berror(?:Key)?\s*:\s*'${K}'`, 'g'),
  ]
  if (/[/\\]schemas[/\\]/.test(rel)) {
    pats.push(new RegExp(String.raw`[,(]\s*'${K}'\s*\)`, 'g'))
    pats.push(new RegExp(String.raw`message\s*:\s*'${K}'`, 'g'))
  }
  const claves = pats.flatMap((p) => [...src.matchAll(p)].map((m) => m[1]!))
  // fail(`${E}.x`) con `const E = 'ns.errors'` en el mismo fichero.
  const consts = Object.fromEntries(
    [...src.matchAll(/const\s+(\w+)\s*=\s*'([a-zA-Z][\w.]*)'/g)].map((m) => [m[1]!, m[2]!])
  )
  for (const m of src.matchAll(/\bfail\(\s*`\$\{(\w+)\}\.([\w.]+)`/g)) {
    if (consts[m[1]!]) claves.push(`${consts[m[1]!]}.${m[2]!}`)
  }
  for (const k of claves) if (!NO_SON_CLAVES.has(k) && !DONDE.has(k)) DONDE.set(k, rel)
}

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('i18n — claves de error que llegan a la pantalla', () => {
  it('premisa: la lectura encuentra las claves, también las de plantilla y las de zod', () => {
    expect(DONDE.size).toBeGreaterThan(500)
    expect(DONDE.has('remesas.errors.sepa_por_remesa')).toBe(true) // fail('…')
    expect(DONDE.has('admin.cuotas.beca_comedor.desborde.errors.ya_resuelto')).toBe(true) // fail(`${ERR}.x`)
    expect(DONDE.has('citas.validation.titulo_vacio')).toBe(true) // zod en schemas/
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...DONDE.keys()])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, `${k} (${DONDE.get(k)})`).toBe('string')
        expect((v as string).trim()).not.toBe('')
      })
    })
  }
})
