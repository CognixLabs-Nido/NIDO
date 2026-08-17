import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { resolverSalidaAlta } from '@/features/alta/lib/salida-alta'

/**
 * Bugs 3 y 4 del alta — salvaguarda i18n de los textos nuevos.
 *
 * Se escribieron primero el código y después las claves, y en medio la pantalla llamaba a
 * `alta.completado.volver_*` sin que existieran: next-intl LANZA con clave ausente, así que
 * la pantalla de alta completada reventaba en los tres idiomas. Este test es el cierre de
 * esa puerta.
 *
 * `alta.imagen.foto_requiere_autorizacion` (wizard, con el checkbox a la vista) y
 * `fotos.nino.requiere_autorizacion` (fichas de admin y familia, donde no lo está) son dos
 * textos distintos a propósito, no un duplicado.
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

/** Las 3 claves de los bugs 3/4 + la compartida por las otras dos fichas con foto. */
const CLAVES: ReadonlyArray<readonly string[]> = [
  ['alta', 'completado', 'volver_admisiones'],
  ['alta', 'completado', 'volver_familia'],
  ['alta', 'imagen', 'foto_requiere_autorizacion'],
  ['fotos', 'nino', 'requiere_autorizacion'],
]

describe('i18n — salida del alta y aviso de foto (bugs 3 y 4)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('%s.%s.%s existe y no está vacío', (...path) => {
        const valor = ruta(msgs, path)
        expect(typeof valor).toBe('string')
        expect((valor as string).trim().length).toBeGreaterThan(0)
      })
    })
  }

  // El enlace elige la clave por código: si `resolverSalidaAlta` devolviera una etiqueta
  // sin traducción, la pantalla volvería a lanzar. Aquí se atan las dos mitades.
  it.each(LOCALES)('la etiqueta que devuelve resolverSalidaAlta existe (%s)', (_locale, msgs) => {
    const completado = ruta(msgs, ['alta', 'completado']) as Record<string, unknown>
    for (const modoDireccion of [true, false]) {
      const { claveEtiqueta } = resolverSalidaAlta(modoDireccion, 'es')
      expect(completado[claveEtiqueta]).toBeTypeOf('string')
    }
  })
})
