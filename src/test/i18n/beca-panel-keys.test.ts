import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { ESTADOS_BECA, VIAS_EXCESO } from '@/features/beca-comedor/lib/panel-becas'

/**
 * Recibos · PR-11 — el panel de becas.
 *
 * Las claves se LEEN del componente: `t('…')`, las dos ramas de un ternario dentro de `t(`, y las
 * de plantilla (`estado_${…}`, `detalle_${…}`, `exceso_${…}`) se expanden con el catálogo de
 * estados y vías de `panel-becas.ts`, no con una lista escrita aquí. Una plantilla nueva sin
 * catálogo se pone roja. Cada traducción lleva los mismos `{marcadores}` que la castellana.
 */
const NS = 'admin.cuotas.beca_comedor.panel'
const CLAVES = new Set<string>()

const componente = readFileSync(
  join(process.cwd(), 'src/features/beca-comedor/components/PanelBecas.tsx'),
  'utf8'
)
for (const m of componente.matchAll(/\bt\(\s*'(\w+)'/g)) CLAVES.add(`${NS}.${m[1]!}`)
for (const m of componente.matchAll(/\bt\(\s*[^'`()]+\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) {
  CLAVES.add(`${NS}.${m[1]!}`)
  CLAVES.add(`${NS}.${m[2]!}`)
}

const CATALOGO: Record<string, readonly string[]> = {
  estado_: ESTADOS_BECA,
  detalle_: ESTADOS_BECA,
  exceso_: VIAS_EXCESO,
}
const plantillas = new Set([...componente.matchAll(/\bt\(\s*`(\w+)\$\{/g)].map((m) => m[1]!))
for (const prefijo of plantillas) {
  const valores = CATALOGO[prefijo]
  if (!valores) throw new Error(`plantilla t(\`${prefijo}\${…}\`) sin catálogo en el test`)
  for (const v of valores) CLAVES.add(`${NS}.${prefijo}${v}`)
}

// La sección de la pestaña.
const pestana = readFileSync(
  join(process.cwd(), 'src/features/beca-comedor/components/BecaComedorPanel.tsx'),
  'utf8'
)
for (const m of pestana.matchAll(/\bt\(\s*'(panel\.\w+)'/g)) {
  CLAVES.add(`admin.cuotas.beca_comedor.${m[1]!}`)
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

describe('i18n — panel de becas (PR-11)', () => {
  it('premisa: la lectura encuentra las cifras, el detalle, las tres plantillas y la sección', () => {
    expect([...plantillas].sort()).toEqual(['detalle_', 'estado_', 'exceso_'])
    for (const k of [
      'stat_aplicado',
      'stat_queda',
      'detalle_ver',
      'detalle_ocultar_corto',
      'estado_en_recibo',
      'detalle_por_aplicar',
      'exceso_transferencia',
      'exceso_por_resolver',
      'por_resolver_aviso',
      'title',
      'hint',
    ]) {
      expect(CLAVES).toContain(`${NS}.${k}`)
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
