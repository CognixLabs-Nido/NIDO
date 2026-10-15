import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Cierre de la purga RGPD — «Pasar a titular» en la ficha de la familia. next-intl LANZA con
 * clave ausente: la ficha de Dirección reventaría en el idioma al que le falte.
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

const BASE = ['admin', 'familias', 'promover'] as const
const CLAVES: ReadonlyArray<readonly string[]> = [
  [...BASE, 'abrir'],
  [...BASE, 'titulo'],
  [...BASE, 'descripcion'],
  [...BASE, 'confirmar'],
  [...BASE, 'cancelar'],
  [...BASE, 'hecho'],
  [...BASE, 'aviso_sin_titular'],
  [...BASE, 'errors', 'no_aplicable'],
]

describe('i18n — pasar a titular (familia sin titular)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('%s.%s.%s.%s', (...path) => {
        const valor = ruta(msgs, path)
        expect(typeof valor).toBe('string')
        expect((valor as string).trim().length).toBeGreaterThan(0)
      })
      it('la descripción interpola el nombre', () => {
        expect(ruta(msgs, [...BASE, 'descripcion'])).toContain('{nombre}')
      })
    })
  }
})
