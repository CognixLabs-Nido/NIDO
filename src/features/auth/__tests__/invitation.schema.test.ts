import { randomUUID } from 'crypto'

import { describe, expect, it } from 'vitest'

import { acceptInvitationSchema, sendInvitationSchema } from '../schemas/invitation'

describe('sendInvitationSchema', () => {
  it('acepta una invitación bien formada para tutor con niño', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: randomUUID(),
      ninoId: randomUUID(),
    })
    expect(result.success).toBe(true)
  })

  it('rechaza tutor_legal sin nino_id', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: randomUUID(),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === 'auth.validation.nino_id_required')
      ).toBe(true)
    }
  })

  it('rechaza profe sin aula_id', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: randomUUID(),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === 'auth.validation.aula_id_required')
      ).toBe(true)
    }
  })
})

describe('acceptInvitationSchema', () => {
  it('acepta datos completos válidos', () => {
    const result = acceptInvitationSchema.safeParse({
      token: randomUUID(),
      nombreCompleto: 'Pruebas Demo',
      password: 'Anaia2026!seguro',
      idiomaPreferido: 'es',
      aceptaTerminos: true,
      aceptaPrivacidad: true,
    })
    expect(result.success).toBe(true)
  })

  it('rechaza si no acepta los términos', () => {
    const result = acceptInvitationSchema.safeParse({
      token: randomUUID(),
      nombreCompleto: 'Pruebas Demo',
      password: 'Anaia2026!seguro',
      idiomaPreferido: 'es',
      aceptaTerminos: false,
      aceptaPrivacidad: true,
    })
    expect(result.success).toBe(false)
  })
})
