import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { CAMPOS_CONOCIDOS, VALORES_CONOCIDOS } from '@/features/export/lib/render-html'

/**
 * Copia legible del export (art. 15). El render pide `doc.campos.*`, `doc.valores.*` y
 * `doc.secciones.*` al traductor, y next-intl LANZA con clave ausente: el export reventaría
 * en el idioma al que le falte. Las claves se LEEN del render (sus conjuntos y las secciones
 * de su código), no se enumeran aquí: una sección nueva sin traducir se pone roja sola.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

const fuente = readFileSync(join(process.cwd(), 'src/features/export/lib/render-html.ts'), 'utf8')
const SECCIONES = [
  ...new Set([
    ...[...fuente.matchAll(/seccion(?:Objeto)?\('([a-z_]+)'/g)].map((m) => m[1]!),
    ...[...fuente.matchAll(/doc\.secciones\.([a-z_]+)/g)].map((m) => m[1]!),
  ]),
]

function doc(msgs: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (msgs.export as Record<string, unknown>).doc as Record<string, Record<string, unknown>>
}

describe('i18n — copia legible del export', () => {
  it('premisa: el render tiene secciones y conjuntos que leer', () => {
    expect(SECCIONES.length).toBeGreaterThan(40)
    expect(SECCIONES).toContain('lista_espera')
    expect(CAMPOS_CONOCIDOS.size).toBeGreaterThan(150)
    expect(VALORES_CONOCIDOS.size).toBeGreaterThan(130)
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(SECCIONES)('doc.secciones.%s', (k) => {
        expect(typeof doc(msgs).secciones?.[k]).toBe('string')
        expect((doc(msgs).secciones?.[k] as string).trim()).not.toBe('')
      })
      it.each([...CAMPOS_CONOCIDOS])('doc.campos.%s', (k) => {
        expect(typeof doc(msgs).campos?.[k]).toBe('string')
        expect((doc(msgs).campos?.[k] as string).trim()).not.toBe('')
      })
      it.each([...VALORES_CONOCIDOS])('doc.valores.%s', (k) => {
        expect(typeof doc(msgs).valores?.[k]).toBe('string')
        expect((doc(msgs).valores?.[k] as string).trim()).not.toBe('')
      })
    })
  }
})
