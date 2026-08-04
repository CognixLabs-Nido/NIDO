import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Alta unificada · U-3 — salvaguarda i18n trilingüe del aviso "tutor ya existente".
 *
 * El bloque `alta.familia_existente` lo pinta el wizard cuando el niño es el 2.º de una
 * familia con tutor existente (y el paso de tutor en modo resumen). Si falta una clave o un
 * idioma, next-intl renderiza el path crudo en pantalla: este test lo detecta sin montar el
 * wizard (mismo patrón que `inicio-resumen-keys.test.ts`).
 */
const KEYS = ['titulo', 'reutilizado', 'por_nino', 'tutor_titulo', 'tutor_nota', 'editar'] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

describe('i18n consistency — alta.familia_existente (U-3)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(KEYS)('alta.familia_existente.%s existe y no está vacío', (key) => {
        const alta = msgs.alta as Record<string, unknown> | undefined
        const ns = alta?.familia_existente as Record<string, string> | undefined
        const value = ns?.[key]
        expect(value).toBeDefined()
        expect(value!.trim().length).toBeGreaterThan(0)
      })

      it('`por_nino` interpola el nombre del niño', () => {
        const alta = msgs.alta as Record<string, unknown>
        const ns = alta.familia_existente as Record<string, string>
        expect(ns.por_nino).toContain('{nombre}')
      })
    })
  }
})
