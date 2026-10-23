import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · PR-7 — el método de pago en la ficha de la familia.
 *
 * Las claves se LEEN de donde se usan: el selector de la ficha (`t('…')`), su sección en la
 * página, los avisos de método de la lista de recibos y los errores de la action. Una clave nueva
 * sin traducir se pone roja sola. Cada traducción lleva los mismos `{marcadores}` que la
 * castellana: sin `{ficha}`, la directora no vería a qué método vuelve el mes siguiente.
 */
function leer(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), 'utf8')
}

const CLAVES = new Set<string>()
for (const m of leer('src/features/familias/components/MetodoPagoFicha.tsx').matchAll(
  /\bt\(\s*'([\w.]+)'/g
))
  CLAVES.add(`admin.familias.metodo_pago.${m[1]!}`)
for (const m of leer('src/app/[locale]/admin/familias/[id]/page.tsx').matchAll(
  /\bt\(\s*'(metodo_pago\.[\w.]+)'/g
))
  CLAVES.add(`admin.familias.${m[1]!}`)
for (const m of leer('src/features/recibos/components/PanelMesRecibos.tsx').matchAll(
  /\bt\(\s*'(metodo_[\w.]+)'/g
))
  CLAVES.add(`recibos_panel.${m[1]!}`)
for (const m of leer('src/features/familias/actions/fijar-metodo-pago-familia.ts').matchAll(
  /'(admin\.familias\.metodo_pago\.errors\.\w+)'/g
))
  CLAVES.add(m[1]!)

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

function marcadores(texto: string): string[] {
  return [...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

describe('i18n — método de pago en la ficha (PR-7)', () => {
  it('premisa: la lectura encuentra el selector, la sección, los avisos y los errores', () => {
    expect(CLAVES).toContain('admin.familias.metodo_pago.etiqueta')
    expect(CLAVES).toContain('admin.familias.metodo_pago.sepa_sin_mandato')
    expect(CLAVES).toContain('admin.familias.metodo_pago.titulo')
    expect(CLAVES).toContain('recibos_panel.metodo_excepcion')
    expect(CLAVES).toContain('recibos_panel.metodo_sepa_sin_mandato')
    expect(CLAVES).toContain('admin.familias.metodo_pago.errors.invalido')
    expect(CLAVES).toContain('admin.familias.metodo_pago.errors.guardado')
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
        expect(marcadores(v as string), k).toEqual(marcadores(hoja(es, k) as string))
      })
    })
  }

  it('la excepción del mes dice a qué método vuelve', () => {
    expect(marcadores(hoja(es, 'recibos_panel.metodo_excepcion') as string)).toEqual(['ficha'])
  })
})
