import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Gate per-hijo de `/family` — textos de la tarjeta «alta en curso». next-intl LANZA con
 * clave ausente: el panel y la ficha reventarían en el idioma al que le falte.
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
  ['family', 'alta_en_curso', 'etiqueta'],
  ['family', 'alta_en_curso', 'titulo'],
  ['family', 'alta_en_curso', 'descripcion'],
  ['family', 'alta_en_curso', 'cta'],
]

describe('i18n — tarjeta «alta en curso» del panel familia', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('%s.%s.%s existe y no está vacío', (...path) => {
        const valor = ruta(msgs, path)
        expect(typeof valor).toBe('string')
        expect((valor as string).trim().length).toBeGreaterThan(0)
      })

      it('el título interpola {nombre}', () => {
        expect(ruta(msgs, ['family', 'alta_en_curso', 'titulo'])).toContain('{nombre}')
      })
    })
  }
})
