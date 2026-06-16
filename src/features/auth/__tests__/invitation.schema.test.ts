import { randomUUID } from 'crypto'

import { describe, expect, it } from 'vitest'

import {
  acceptInvitationSchema,
  invitarFamiliaConEsqueletoSchema,
  sendInvitationSchema,
} from '../schemas/invitation'

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

  it('acepta tutor_legal con tipoVinculo secundario', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'tutor2@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: randomUUID(),
      ninoId: randomUUID(),
      tipoVinculo: 'tutor_legal_secundario',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza tipoVinculo en invitación de profe (no es rol familiar)', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: randomUUID(),
      aulaId: randomUUID(),
      tipoVinculo: 'tutor_legal_principal',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === 'auth.validation.tipo_vinculo_invalido')
      ).toBe(true)
    }
  })

  it('rechaza tipoVinculo "autorizado" (enum solo principal/secundario)', () => {
    const result = sendInvitationSchema.safeParse({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: randomUUID(),
      ninoId: randomUUID(),
      tipoVinculo: 'autorizado',
    })
    expect(result.success).toBe(false)
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

  it('acepta parentesco "otro" con descripción', () => {
    const result = acceptInvitationSchema.safeParse({
      token: randomUUID(),
      nombreCompleto: 'Pruebas Demo',
      password: 'Anaia2026!seguro',
      idiomaPreferido: 'es',
      aceptaTerminos: true,
      aceptaPrivacidad: true,
      parentesco: 'otro',
      descripcionParentesco: 'Tutora de acogida',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza parentesco "otro" sin descripción', () => {
    const result = acceptInvitationSchema.safeParse({
      token: randomUUID(),
      nombreCompleto: 'Pruebas Demo',
      password: 'Anaia2026!seguro',
      idiomaPreferido: 'es',
      aceptaTerminos: true,
      aceptaPrivacidad: true,
      parentesco: 'otro',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === 'vinculo.validation.descripcion_requerida')
      ).toBe(true)
    }
  })
})

describe('invitarFamiliaConEsqueletoSchema', () => {
  it('acepta nombre + aula + email + tipoVinculo', () => {
    const result = invitarFamiliaConEsqueletoSchema.safeParse({
      nombreNino: 'Niño Demo',
      aulaId: randomUUID(),
      email: 'tutor@nido.test',
      tipoVinculo: 'tutor_legal_principal',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza email inválido y nombre vacío', () => {
    expect(
      invitarFamiliaConEsqueletoSchema.safeParse({
        nombreNino: '',
        aulaId: randomUUID(),
        email: 'no-es-email',
        tipoVinculo: 'tutor_legal_principal',
      }).success
    ).toBe(false)
  })

  it('rechaza aula no-uuid', () => {
    expect(
      invitarFamiliaConEsqueletoSchema.safeParse({
        nombreNino: 'Niño Demo',
        aulaId: 'no-uuid',
        email: 'tutor@nido.test',
        tipoVinculo: 'tutor_legal_principal',
      }).success
    ).toBe(false)
  })
})
