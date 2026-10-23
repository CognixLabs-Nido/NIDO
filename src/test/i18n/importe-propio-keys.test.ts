import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · PR-6 — importe propio por niño y por familia.
 *
 * Las claves del editor del importe propio y del recuento en el panel se LEEN de sus componentes
 * (`t('…')`), y los errores de la action, de su código: cualquier clave nueva sin traducir se
 * pone roja sola. Cada traducción lleva los mismos `{marcadores}` que la castellana: un
 * `{precio}` que faltara dejaría a la directora sin ver qué precio sustituye.
 */
const FUENTES: ReadonlyArray<[string, string]> = [
  ['src/features/cuotas-config/components/ImportesPropios.tsx', 'admin.cuotas.importe_propio'],
  ['src/features/cuotas-config/components/AsignacionPermanentePanel.tsx', 'admin.cuotas'],
]

const CLAVES = new Set<string>()
for (const [ruta, namespace] of FUENTES) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`${namespace}.${m[1]!}`)
  // El editor elige entre dos claves con un ternario dentro de t(…).
  for (const m of src.matchAll(/\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)) {
    if (ruta.endsWith('ImportesPropios.tsx')) {
      CLAVES.add(`${namespace}.${m[1]!}`)
      CLAVES.add(`${namespace}.${m[2]!}`)
    }
  }
}
const accion = readFileSync(
  join(process.cwd(), 'src/features/cuotas-config/actions/fijar-importe-propio.ts'),
  'utf8'
)
for (const m of accion.matchAll(/'(cuotas_config\.errors\.\w+)'/g)) CLAVES.add(m[1]!)

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

describe('i18n — importe propio (PR-6)', () => {
  it('premisa: la lectura encuentra el editor, el precio por día, el recuento y los errores', () => {
    expect(CLAVES).toContain('admin.cuotas.importe_propio.titulo')
    expect(CLAVES).toContain('admin.cuotas.importe_propio.precio_concepto')
    expect(CLAVES).toContain('admin.cuotas.importe_propio.precio_concepto_dia')
    expect(CLAVES).toContain('admin.cuotas.importe_propio.n_fila')
    expect(CLAVES).toContain('cuotas_config.errors.importe_no_admitido')
    expect(CLAVES).toContain('cuotas_config.errors.no_asignado')
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

  it('el precio que se sustituye sale en el texto', () => {
    for (const k of ['precio_concepto', 'precio_concepto_dia']) {
      expect(marcadores(hoja(es, `admin.cuotas.importe_propio.${k}`) as string)).toEqual(['precio'])
    }
  })
})
