import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * F9-1 — Paridad i18n trilingüe del namespace `informes` (+ la entrada de nav en
 * admin). Recorre todas las claves anidadas de `es` y exige que existan, no
 * vacías, en `en` y `va`. Si olvido una clave o un idioma, falla sin renderizar
 * la página.
 */
function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') {
      for (const [kk, vv] of flatten(v as Record<string, unknown>, key)) out.set(kk, vv)
    } else {
      out.set(key, String(v))
    }
  }
  return out
}

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('i18n consistency — informes (F9-1)', () => {
  const esNs = (es as Record<string, unknown>).informes as Record<string, unknown>
  const esKeys = Array.from(flatten(esNs).keys())

  it('el namespace es no está vacío', () => {
    expect(esKeys.length).toBeGreaterThan(20)
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      const ns = msgs.informes as Record<string, unknown>
      const flat = flatten(ns ?? {})
      it.each(esKeys)(`informes.%s existe y no está vacío`, (key) => {
        const value = flat.get(key)
        expect(value, `falta informes.${key} en ${locale}`).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })
    })
  }

  it('la entrada de nav admin existe en los 3 idiomas', () => {
    for (const [, msgs] of [['es', es], ...LOCALES] as Array<[string, Record<string, unknown>]>) {
      const admin = msgs.admin as Record<string, Record<string, string>>
      expect(admin.nav.informes?.length ?? 0).toBeGreaterThan(0)
    }
  })
})
