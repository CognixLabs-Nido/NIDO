import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { VALORES_CONOCIDOS } from '@/features/export/lib/render-html'

/**
 * Recibos · PR-1c — el sobrante cuando el cheque supera el recibo.
 *
 * Las claves que ningún otro test lee se LEEN de su código: el toast de quitar la línea del saldo a
 * favor (`feedback(r, 'sobrante_…')` en el diálogo de edición), los errores de «Resolver» (todas
 * las `${ERR}.…` de la action, también las de la beca) y la lista de transferencias (`t('…')`). El
 * diálogo del desborde lo cubre `recibos-desborde-validar-keys`; la gestión de cobros y el diálogo
 * del cheque, `recibos-cheque-keys` y `recibos-devolucion-keys`. Y el export etiqueta el origen.
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
for (const m of leer('src/features/recibos/components/EditarReciboDialog.tsx').matchAll(
  /'(sobrante_\w+)'/g
)) {
  CLAVES.add(`recibos_panel.${m[1]!}`)
}
for (const m of leer('src/features/beca-comedor/actions/resolver-desborde.ts').matchAll(
  /`\$\{ERR\}\.(\w+)`/g
)) {
  CLAVES.add(`admin.cuotas.beca_comedor.desborde.errors.${m[1]!}`)
}
for (const m of leer('src/features/beca-comedor/components/TransferenciasBecaPanel.tsx').matchAll(
  /\bt\(\s*'([\w.]+)'/g
)) {
  CLAVES.add(`remesas.transferencias_beca.${m[1]!}`)
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

describe('i18n — el sobrante de un cheque (PR-1c)', () => {
  it('premisa: la lectura encuentra el toast, los errores nuevos y la marca de la transferencia', () => {
    for (const k of [
      'recibos_panel.sobrante_quitado',
      'admin.cuotas.beca_comedor.desborde.errors.sin_hijos_cheque',
      'admin.cuotas.beca_comedor.desborde.errors.recibo_siguiente_cerrado',
      'admin.cuotas.beca_comedor.desborde.errors.sin_becas',
      'remesas.transferencias_beca.origen_cheque',
      'remesas.transferencias_beca.marcar_realizada',
    ]) {
      expect(CLAVES).toContain(k)
    }
  })

  it('el export etiqueta los dos orígenes', () => {
    for (const v of ['beca', 'cheque']) expect(VALORES_CONOCIDOS.has(v), v).toBe(true)
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES, 'export.doc.valores.beca', 'export.doc.valores.cheque'])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
        expect(marcadores(v as string), k).toEqual(marcadores(hoja(es, k) as string))
      })
    })
  }
})
