import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { BADGE_ESTADO_HISTORIAL } from '@/features/recibos/components/HistorialRecibosFamilia'
import { TIPOS_RECIBO_HISTORIAL } from '@/features/recibos/lib/historial-familia'

/**
 * F-6 — el histórico de recibos de la familia y el filtro por familia de Cuotas.
 *
 * Las claves literales se LEEN de su código (`t('…')` del histórico, de la ficha y del detalle, y
 * las del filtro en el panel del mes). Las que se componen (`estado.${…}`, `tipo.${…}`) se COPIAN
 * del catálogo: los estados de `BADGE_ESTADO_HISTORIAL` (un `Record` sobre el tipo, no compila si
 * falta uno) y los tipos de `TIPOS_RECIBO_HISTORIAL`.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function leer(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), 'utf8')
}

const NS = 'admin.familias.recibos'
const CLAVES = new Set<string>()
for (const ruta of [
  'src/features/recibos/components/HistorialRecibosFamilia.tsx',
  'src/app/[locale]/admin/familias/[id]/recibos/[reciboId]/page.tsx',
]) {
  for (const m of leer(ruta).matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`${NS}.${m[1]!}`)
  // Las claves elegidas con un ternario, `cond ? 'a' : 'b'`: en estos ficheros todo par de cadenas
  // así es una clave (si no lo fuera, su `it` daría rojo, que es el lado seguro).
  for (const m of leer(ruta).matchAll(/\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) {
    CLAVES.add(`${NS}.${m[1]!}`)
    CLAVES.add(`${NS}.${m[2]!}`)
  }
}
for (const m of leer('src/app/[locale]/admin/familias/[id]/page.tsx').matchAll(
  /\bt\(\s*'(recibos\.[\w.]+)'/g
)) {
  CLAVES.add(`admin.familias.${m[1]!}`)
}
for (const m of leer('src/features/recibos/components/PanelMesRecibos.tsx').matchAll(
  /\bt\(\s*'((?:filtro|quitar)_\w+)'/g
)) {
  CLAVES.add(`recibos_panel.${m[1]!}`)
}
for (const e of Object.keys(BADGE_ESTADO_HISTORIAL)) CLAVES.add(`${NS}.estado.${e}`)
for (const tipo of TIPOS_RECIBO_HISTORIAL) CLAVES.add(`${NS}.tipo.${tipo}`)

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

describe('i18n — histórico de recibos de la familia y filtro de Cuotas (F-6)', () => {
  it('premisa: la lectura encuentra las del histórico, la ficha, el detalle, el filtro y los catálogos', () => {
    for (const k of [
      `${NS}.forma`,
      `${NS}.devolucion_siguiente`,
      `${NS}.origen_regiro`,
      `${NS}.origen_diferencia`,
      `${NS}.incluye_sobrante`,
      `${NS}.sobrante_diferido`,
      `${NS}.titulo`,
      `${NS}.error`,
      `${NS}.vacio`,
      `${NS}.volver`,
      `${NS}.error_detalle`,
      `${NS}.estado.en_remesa`,
      `${NS}.tipo.diferencia_cheque`,
      'recibos_panel.filtro_familia',
      'recibos_panel.filtro_todas',
      'recibos_panel.filtro_sin_resultados',
      'recibos_panel.quitar_filtro',
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
