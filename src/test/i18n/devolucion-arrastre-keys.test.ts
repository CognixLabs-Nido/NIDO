import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { VALORES_CONOCIDOS } from '@/features/export/lib/render-html'
import { SALIDAS_DEVOLUCION } from '@/features/remesas/schemas/remesa'

/**
 * Recibos · PR-14 — la devolución llevada al siguiente recibo.
 *
 * El diálogo de edición del recibo marca la línea de la devolución, no deja editarla y avisa al
 * quitarla; la acción de las líneas devuelve su error propio. Las claves se LEEN de los dos
 * ficheros (`t('…')` sobre `recibos_panel` y las claves completas `'recibos_panel.…'`): una clave
 * nueva sin traducir se pone roja sola. Las de «Resolver devolución» las cubre
 * `recibos-devolucion-keys`. Y el export del art. 15 etiqueta cada salida.
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
const dialogo = leer('src/features/recibos/components/EditarReciboDialog.tsx')
for (const m of dialogo.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`recibos_panel.${m[1]!}`)
// `feedback(r, 'clave')` pinta `t(clave)`.
for (const m of dialogo.matchAll(/'(linea_\w+|arrastre_\w+)'/g))
  CLAVES.add(`recibos_panel.${m[1]!}`)
for (const m of leer('src/features/recibos/actions/lineas-recibo.ts').matchAll(
  /'(recibos_panel\.[\w.]+)'/g
)) {
  CLAVES.add(m[1]!)
}

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

describe('i18n — devolución llevada al siguiente recibo (PR-14)', () => {
  it('premisa: la lectura encuentra la marca, el aviso, el toast y el error de la línea', () => {
    for (const k of [
      'recibos_panel.linea_arrastre',
      'recibos_panel.quitar_arrastre_confirm',
      'recibos_panel.arrastre_quitado',
      'recibos_panel.errors.linea_arrastre',
      'recibos_panel.linea_manual',
      'recibos_panel.linea_borrada',
    ]) {
      expect(CLAVES).toContain(k)
    }
  })

  it('el export etiqueta todas las salidas de una devolución', () => {
    for (const s of SALIDAS_DEVOLUCION) expect(VALORES_CONOCIDOS.has(s), s).toBe(true)
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
        expect(marcadores(v as string), k).toEqual(marcadores(hoja(es, k) as string))
      })

      it('export.doc.valores.siguiente_recibo', () => {
        const v = hoja(msgs, 'export.doc.valores.siguiente_recibo')
        expect(typeof v).toBe('string')
      })
    })
  }
})
