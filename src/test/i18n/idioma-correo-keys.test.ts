import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { IDIOMAS_CORREO } from '@/features/auth/schemas/invitation'

/**
 * Selector «Idioma del correo» de las invitaciones (personal y lista de espera). next-intl LANZA
 * con clave ausente: el diálogo de invitar reventaría en el idioma al que le falte.
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

describe('i18n — selector de idioma del correo de invitación', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(['label', ...IDIOMAS_CORREO])('auth.invitation.idioma_correo.%s existe', (clave) => {
        const valor = ruta(msgs, ['auth', 'invitation', 'idioma_correo', clave])
        expect(typeof valor).toBe('string')
        expect((valor as string).trim().length).toBeGreaterThan(0)
      })
    })
  }
})
