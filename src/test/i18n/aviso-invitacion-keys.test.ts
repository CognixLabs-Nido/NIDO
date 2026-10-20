import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * PR 1 (Fase 4) — el aviso de invitación a una cuenta que ya existe (`enviarAvisoInvitacion`)
 * sale en el idioma de la cuenta. Si falta una clave, next-intl pondría el path crudo en el correo.
 */
const CLAVES = [
  'asunto',
  'saludo',
  'intro_centro',
  'intro_sin_centro',
  'como_aceptar',
  'boton',
  'no_esperada',
] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function aviso(msgs: Record<string, unknown>): Record<string, string> {
  const auth = msgs.auth as Record<string, Record<string, unknown>>
  return auth.invitation!.aviso_correo as Record<string, string>
}

describe('i18n — aviso de invitación por correo', () => {
  for (const [locale, msgs] of LOCALES) {
    it.each(CLAVES)(`${locale}: auth.invitation.aviso_correo.%s existe y no está vacío`, (k) => {
      expect(aviso(msgs)[k]?.trim().length ?? 0).toBeGreaterThan(0)
    })

    it(`${locale}: intro_centro interpola el centro`, () => {
      expect(aviso(msgs).intro_centro).toContain('{centro}')
    })
  }
})
