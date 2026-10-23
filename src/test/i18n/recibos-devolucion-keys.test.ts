import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { SALIDAS_DEVOLUCION } from '@/features/remesas/schemas/remesa'

/**
 * Recibos · PR-2 — devoluciones con una sola salida.
 *
 * Las claves de `remesas.*` que pintan «Marcar devuelto», «Resolver devolución» y el panel de
 * «Cobros y devoluciones» se LEEN de sus componentes (`t('…')` y `t(`…${x}`)` con sus valores), no
 * se enumeran: una clave nueva sin traducir se pone roja sola. Los valores de las plantillas de la
 * salida salen de `SALIDAS_DEVOLUCION`, la misma lista que valida el esquema.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

const COMPONENTES = [
  'src/features/remesas/components/DevolucionesPanel.tsx',
  'src/features/remesas/components/MarcarDevueltoDialog.tsx',
  'src/features/remesas/components/ResolverDevolucionDialog.tsx',
]
const PLANTILLAS: Record<string, readonly string[]> = {
  'estado_recibo.': ['pendiente_procesar', 'enviado_banco', 'devuelto', 'cobrado_manual'],
  'salidas_cobrado.': SALIDAS_DEVOLUCION,
  'resolver_dialog.salidas.': SALIDAS_DEVOLUCION,
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

// Los errores que devuelven las actions de la devolución (se pintan con tErrors, no con t).
const ERRORES_ACTIONS = [
  'src/features/remesas/actions/marcar-recibo-devuelto.ts',
  'src/features/remesas/actions/resolver-devolucion.ts',
  'src/features/remesas/actions/marcar-cobrado-manual.ts',
  'src/features/remesas/actions/cobrar-con-cheque.ts',
  'src/features/remesas/schemas/remesa.ts',
]
const CLAVES_ERROR = new Set<string>()
for (const ruta of ERRORES_ACTIONS) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/'(remesas\.(?:errors|validation)\.[\w]+)'/g))
    CLAVES_ERROR.add(m[1]!)
}

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('i18n — devoluciones con una sola salida (PR-2)', () => {
  it('premisa: la lectura encuentra las claves de la devolución, también las de plantilla', () => {
    expect(CLAVES.size).toBeGreaterThan(30)
    expect(CLAVES).toContain('remesas.devuelto_dialog.gastos')
    expect(CLAVES).toContain('remesas.resolver_dialog.a_cobrar_con_gastos')
    expect(CLAVES).toContain('remesas.resolver_dialog.salidas.banco')
    expect(CLAVES).toContain('remesas.salidas_cobrado.transferencia')
    expect(CLAVES_ERROR).toContain('remesas.errors.devolucion_ya_resuelta')
    expect(CLAVES_ERROR).toContain('remesas.validation.devolucion_antes_del_envio')
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES, ...CLAVES_ERROR])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
      })
    })
  }
})
