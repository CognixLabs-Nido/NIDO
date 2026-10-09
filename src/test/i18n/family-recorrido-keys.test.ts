import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * F-8 (familia) — sección «Recorrido» de la ficha del niño. next-intl LANZA con clave
 * ausente: la ficha del tutor legal reventaría en el idioma al que le falte.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function ruta(msgs: Record<string, unknown>, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (acc, k) => (acc as Record<string, unknown> | undefined)?.[k],
    msgs as unknown
  )
}

const CLAVES: ReadonlyArray<readonly string[]> = [
  ['family', 'nino', 'recorrido', 'titulo'],
  ['family', 'nino', 'recorrido', 'vacio'],
  ['family', 'nino', 'recorrido', 'en_curso'],
  ['family', 'nino', 'recorrido', 'terminado'],
  ['family', 'nino', 'recorrido', 'hoy'],
]

describe('i18n — recorrido del niño (familia)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('%s.%s.%s.%s existe y no está vacío', (...path) => {
        const valor = ruta(msgs, path)
        expect(typeof valor).toBe('string')
        expect((valor as string).trim().length).toBeGreaterThan(0)
      })
    })
  }
})
