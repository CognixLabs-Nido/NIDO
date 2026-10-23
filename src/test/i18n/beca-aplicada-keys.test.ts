import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · PR-5 — una beca descontada pasa a «aplicada».
 *
 * Las claves de la lista de cargas se LEEN de su componente (`t('…')`), y los errores de las
 * actions de cargas y de confirmar, de su código: el «descontadas», el motivo por el que una
 * carga ya no se edita y los dos errores nuevos, y cualquier clave nueva sin traducir, se ponen
 * rojos solos. Cada traducción lleva los mismos `{marcadores}` que la castellana.
 */
const CLAVES = new Set<string>()

const componente = readFileSync(
  join(process.cwd(), 'src/features/beca-comedor/components/CargasBeca.tsx'),
  'utf8'
)
for (const m of componente.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
  CLAVES.add(`admin.cuotas.beca_comedor.${m[1]!}`)
}
if (/\bt\(\s*`/.test(componente)) throw new Error('plantilla t(`…`) sin valores en el test')

for (const [ruta, patron] of [
  [
    'src/features/beca-comedor/actions/cargas-beca.ts',
    /'(admin\.cuotas\.beca_comedor\.errors\.\w+)'/g,
  ],
  ['src/features/recibos/actions/confirmar-recibo.ts', /'(recibos_panel\.errors\.\w+)'/g],
] as const) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(patron)) CLAVES.add(m[1]!)
}

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

describe('i18n — beca aplicada (PR-5)', () => {
  it('premisa: la lectura encuentra el «descontadas», el motivo y los dos errores', () => {
    expect(CLAVES.size).toBeGreaterThan(20)
    expect(CLAVES).toContain('admin.cuotas.beca_comedor.descontadas')
    expect(CLAVES).toContain('admin.cuotas.beca_comedor.no_editable_descontada')
    expect(CLAVES).toContain('admin.cuotas.beca_comedor.errors.carga_aplicada')
    expect(CLAVES).toContain('recibos_panel.errors.beca_ya_aplicada')
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

  it('«descontadas» dice cuántas', () => {
    expect(marcadores(hoja(es, 'admin.cuotas.beca_comedor.descontadas') as string)).toEqual(['n'])
  })
})
