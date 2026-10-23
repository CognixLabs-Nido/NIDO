import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · PR-1b — cheque guardería / ticket restaurant.
 *
 *  - Las claves de `remesas.*` que pintan «Marcar cobrado» y «Cobros y devoluciones» se LEEN de
 *    sus componentes (`t('…')` y `t(`…${x}`)` con sus valores), no se enumeran: una clave nueva sin
 *    traducir se pone roja sola.
 *  - La etiqueta del método es la que decidió el responsable, en los cuatro sitios donde sale. En
 *    inglés es solo «Childcare voucher»: «Childcare voucher / Meal voucher» parecerían dos
 *    opciones distintas, y aquí es una sola.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

const ETIQUETA: Record<string, string> = {
  es: 'Cheque guardería / Ticket restaurant',
  en: 'Childcare voucher',
  va: 'Xec guarderia / Tiquet restaurant',
}
const SITIOS_ETIQUETA = [
  'admin.cuotas.metodos.cheque_guarderia',
  'recibos_panel.metodos.cheque_guarderia',
  'recibos.metodos.cheque_guarderia',
  'export.doc.valores.cheque_guarderia',
  'remesas.forma_cobro.cheque_guarderia',
  'cierre_cobros.metodos.cheque_guarderia',
]

const COMPONENTES = [
  'src/features/remesas/components/MarcarCobradoDialog.tsx',
  'src/features/remesas/components/DevolucionesPanel.tsx',
]
// Los valores que recorren las plantillas `t(`prefijo.${x}`)` de esos componentes.
const PLANTILLAS: Record<string, readonly string[]> = {
  'forma_cobro.': ['efectivo', 'transferencia', 'cheque_guarderia'],
  'cobro_dialog.metodos_diferencia.': ['sepa', 'efectivo', 'transferencia'],
  'estado_recibo.': ['pendiente_procesar', 'enviado_banco', 'devuelto', 'cobrado_manual'],
  // PR-2: «Devuelto · cobrado por: …» en el panel.
  'salidas_cobrado.': ['banco', 'efectivo', 'transferencia'],
}

const CLAVES = new Set<string>()
for (const ruta of COMPONENTES) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`remesas.${m[1]!}`)
  for (const m of src.matchAll(/\bt\(\s*`([\w.]+\.)\$\{/g)) {
    const valores = PLANTILLAS[m[1]!]
    if (!valores) throw new Error(`plantilla sin valores en el test: ${m[1]}`)
    for (const v of valores) CLAVES.add(`remesas.${m[1]!}${v}`)
  }
}

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('i18n — cobro con cheque (PR-1b)', () => {
  it('premisa: la lectura encuentra las claves del cheque, también las de plantilla', () => {
    expect(CLAVES.size).toBeGreaterThan(25)
    expect(CLAVES).toContain('remesas.cobro_dialog.importe_cheque')
    expect(CLAVES).toContain('remesas.cheque_de')
    expect(CLAVES).toContain('remesas.forma_cobro.cheque_guarderia')
    expect(CLAVES).toContain('remesas.cobro_dialog.metodos_diferencia.sepa')
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
      })

      it.each(SITIOS_ETIQUETA)(`%s es «${ETIQUETA[locale]}»`, (k) => {
        expect(hoja(msgs, k)).toBe(ETIQUETA[locale])
      })
    })
  }

  it('en inglés la etiqueta es una sola opción: sin barra', () => {
    for (const k of SITIOS_ETIQUETA) expect(hoja(en, k)).not.toContain('/')
  })
})
