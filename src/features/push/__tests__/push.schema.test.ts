import { describe, expect, it } from 'vitest'

import { desuscribirPushInputSchema, suscribirPushInputSchema } from '../schemas/push'

const ENDPOINT_VALIDO = 'https://fcm.googleapis.com/fcm/send/cT5jZ8XYZ-abc'
const P256DH =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'

describe('push — suscribirPushInputSchema', () => {
  it('acepta input válido completo', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: P256DH,
      auth: AUTH,
      user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
    })
    expect(r.success).toBe(true)
  })

  it('acepta input sin user_agent', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: P256DH,
      auth: AUTH,
    })
    expect(r.success).toBe(true)
  })

  it('acepta user_agent null', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: P256DH,
      auth: AUTH,
      user_agent: null,
    })
    expect(r.success).toBe(true)
  })

  it('rechaza endpoint no URL', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: 'no-es-url',
      p256dh: P256DH,
      auth: AUTH,
    })
    expect(r.success).toBe(false)
  })

  it('rechaza endpoint > 2048 chars', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: 'https://example.com/' + 'a'.repeat(2050),
      p256dh: P256DH,
      auth: AUTH,
    })
    expect(r.success).toBe(false)
  })

  it('rechaza p256dh vacío', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: '',
      auth: AUTH,
    })
    expect(r.success).toBe(false)
  })

  it('rechaza auth vacío', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: P256DH,
      auth: '',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza p256dh > 256 chars', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: 'a'.repeat(257),
      auth: AUTH,
    })
    expect(r.success).toBe(false)
  })

  it('rechaza auth > 64 chars', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: ENDPOINT_VALIDO,
      p256dh: P256DH,
      auth: 'a'.repeat(65),
    })
    expect(r.success).toBe(false)
  })

  it('los mensajes de error son claves i18n', () => {
    const r = suscribirPushInputSchema.safeParse({
      endpoint: 'no-es-url',
      p256dh: P256DH,
      auth: AUTH,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/^push\.errors\./)
    }
  })
})

describe('push — desuscribirPushInputSchema', () => {
  it('acepta endpoint válido', () => {
    const r = desuscribirPushInputSchema.safeParse({ endpoint: ENDPOINT_VALIDO })
    expect(r.success).toBe(true)
  })

  it('rechaza endpoint no URL', () => {
    const r = desuscribirPushInputSchema.safeParse({ endpoint: 'not-a-url' })
    expect(r.success).toBe(false)
  })

  it('rechaza objeto sin endpoint', () => {
    const r = desuscribirPushInputSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})
