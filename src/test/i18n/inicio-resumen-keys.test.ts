import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * AG-15 — Salvaguarda de i18n trilingüe del resumen de Inicio.
 *
 * El namespace `inicio_resumen` debe existir completo en es/en/va: si me
 * olvido una clave o un idioma, este test lo detecta sin renderizar la
 * página real (mismo patrón que `aulas-keys.test.ts`).
 */
const KEYS = [
  'title',
  'hoy',
  'resto_semana',
  'vacio_hoy',
  'vacio_semana',
  'vacio_total',
  'ver_agenda',
  'ver_calendario',
  'todo_el_dia',
] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('i18n consistency — inicio_resumen (AG-15)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(KEYS)('inicio_resumen.%s existe y no está vacío', (key) => {
        const ns = msgs.inicio_resumen as Record<string, string> | undefined
        const value = ns?.[key]
        expect(value).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })
    })
  }
})
