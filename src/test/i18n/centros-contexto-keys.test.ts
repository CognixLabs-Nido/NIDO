import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Multicentro · Fase 1 — selector y conmutador de centro. next-intl LANZA con clave ausente: el
 * selector reventaría en el idioma al que le falte.
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
  ['centros', 'elegir', 'titulo'],
  ['centros', 'elegir', 'subtitulo'],
  ['centros', 'elegir', 'sin_nombre'],
  ['centros', 'elegir', 'errors', 'invalido'],
  ['centros', 'elegir', 'errors', 'no_es_tuyo'],
  ['centros', 'conmutador', 'etiqueta'],
  ['centros', 'conmutador', 'cambiar'],
]

describe('i18n — selector y conmutador de centro', () => {
  for (const [locale, msgs] of LOCALES) {
    it.each(CLAVES)(`${locale}: %s.%s.%s`, (...path) => {
      const valor = ruta(msgs, path)
      expect(typeof valor, path.join('.')).toBe('string')
      expect((valor as string).length).toBeGreaterThan(0)
    })
  }
})
