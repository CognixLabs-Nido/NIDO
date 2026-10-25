import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * F-6 — el histórico general de recibos. Las claves se LEEN de su código (`t('…')` de la página y
 * de los filtros) y la entrada del menú, de `sidebar-items`. Las de cada fila son las del histórico
 * de la ficha, que cubre `historial-recibos-familia-keys`.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function leer(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), 'utf8')
}

const CLAVES = new Set<string>()
for (const ruta of [
  'src/app/[locale]/admin/recibos/page.tsx',
  'src/features/recibos/components/FiltrosHistorialRecibos.tsx',
]) {
  for (const m of leer(ruta).matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`admin.recibos.${m[1]!}`)
}
const nav = leer('src/shared/lib/sidebar-items.tsx').match(/admin\/recibos`, label: t\('(\w+)'\)/)
if (nav) CLAVES.add(`admin.nav.${nav[1]!}`)

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

function marcadores(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]!))].sort()
}

describe('i18n — histórico general de recibos (F-6)', () => {
  it('premisa: la lectura encuentra las de la página, los filtros, la paginación y el menú', () => {
    for (const k of [
      'admin.recibos.title',
      'admin.recibos.error',
      'admin.recibos.error_opciones',
      'admin.recibos.mostrando',
      'admin.recibos.pagina_de',
      'admin.recibos.filtro_nino',
      'admin.recibos.todos_los_meses',
      'admin.recibos.quitar_filtros',
      'admin.nav.recibos',
    ]) {
      expect(CLAVES).toContain(k)
    }
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
})
