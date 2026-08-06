import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Alta unificada · U-5 — salvaguarda i18n del botón único y su detección por email.
 *
 * `admin.admisiones.deteccion.*` lo pinta el diálogo al teclear el email del tutor. Si falta
 * una clave o un idioma, next-intl renderiza el path crudo. Además se comprueba que las
 * claves que SÍ siguen vivas del namespace `anadirHijo` (el push y los errores que usa
 * `vincularHijoATutorExistente`) no se cayeron al podar el diálogo jubilado.
 */
const DETECCION = [
  'ayuda',
  'resolviendo',
  'familia_nueva',
  'familia_existente',
  'cuenta_sin_familia_aqui',
] as const

/** Las que siguen en uso tras jubilar "añadir hijo a familia existente". */
const ANADIR_HIJO_VIVAS = ['push_titulo', 'push_cuerpo'] as const
const ANADIR_HIJO_ERRORS = ['parentesco_requerido', 'no_autorizado', 'colision'] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function admisiones(msgs: Record<string, unknown>): Record<string, unknown> {
  return (msgs.admin as Record<string, unknown>).admisiones as Record<string, unknown>
}

describe('i18n consistency — botón único de admisiones (U-5)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(DETECCION)('admin.admisiones.deteccion.%s existe y no está vacío', (key) => {
        const ns = admisiones(msgs).deteccion as Record<string, string> | undefined
        expect(ns?.[key]).toBeDefined()
        expect(ns![key]!.trim().length).toBeGreaterThan(0)
      })

      it('`familia_existente` interpola la familia', () => {
        const ns = admisiones(msgs).deteccion as Record<string, string>
        expect(ns.familia_existente).toContain('{familia}')
      })

      it.each(ANADIR_HIJO_VIVAS)('anadirHijo.%s sobrevive a la poda (lo usa el push)', (key) => {
        const ns = admisiones(msgs).anadirHijo as Record<string, string>
        expect(ns[key]).toBeDefined()
      })

      it.each(ANADIR_HIJO_ERRORS)('anadirHijo.errors.%s sobrevive a la poda', (key) => {
        const ns = admisiones(msgs).anadirHijo as Record<string, Record<string, string>>
        expect(ns.errors?.[key]).toBeDefined()
      })
    })
  }
})
