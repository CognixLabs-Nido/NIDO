import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · PR-10 — la carga de beca comedor por alumno.
 *
 * Las claves del formulario de la carga se LEEN de su componente (`t('…')`, también las de un
 * ternario dentro de `t(`), y los errores de la action, de su código: una clave nueva sin
 * traducir se pone roja sola. Cada traducción lleva los mismos `{marcadores}` que la castellana.
 */
const CLAVES = new Set<string>()

const componente = readFileSync(
  join(process.cwd(), 'src/features/beca-comedor/components/CargaFormDialog.tsx'),
  'utf8'
)
for (const m of componente.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
  CLAVES.add(`admin.cuotas.beca_comedor.${m[1]!}`)
}
if (/\bt\(\s*`/.test(componente)) throw new Error('plantilla t(`…`) sin valores en el test')

const action = readFileSync(
  join(process.cwd(), 'src/features/beca-comedor/actions/cargas-beca.ts'),
  'utf8'
)
for (const m of action.matchAll(/'(admin\.cuotas\.beca_comedor\.errors\.\w+)'/g)) CLAVES.add(m[1]!)
if (/beca_comedor\.errors\.\$\{/.test(action)) {
  throw new Error('clave de error con plantilla en la action: el test no la ve')
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

describe('i18n — carga de beca comedor por alumno (PR-10)', () => {
  it('premisa: la lectura encuentra la selección, el relleno, el aviso y los errores nuevos', () => {
    expect(CLAVES.size).toBeGreaterThan(25)
    for (const k of [
      'poner_seleccion',
      'relleno_de',
      'sin_carga_anterior',
      'recibo_validado',
      'fila_nuevo',
      'importe_de',
      'errors.sin_importes',
      'errors.no_becado',
      'errors.carga_aplicada',
    ]) {
      expect(CLAVES).toContain(`admin.cuotas.beca_comedor.${k}`)
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

  it('la lista de cargas ya no usa el motivo «descontada»: se edita lo no descontado', () => {
    expect(hoja(es, 'admin.cuotas.beca_comedor.no_editable_descontada')).toBeUndefined()
  })
})
