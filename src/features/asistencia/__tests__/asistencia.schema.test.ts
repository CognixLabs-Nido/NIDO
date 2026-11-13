import { describe, expect, it } from 'vitest'

import { asistenciaInputSchema } from '../schemas/asistencia'

describe('asistencia — schema Zod', () => {
  it('presente sin hora_llegada falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: null,
      observaciones: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('asistencia.validation.requiere_hora_llegada')
    }
  })

  it('presente con hora_llegada válida', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '09:15',
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('llegada_tarde sin hora_llegada falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'llegada_tarde',
      hora_llegada: null,
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('salida_temprana ya no es un estado (retirada el 2026-11-13: no se pidió nunca)', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'salida_temprana',
      hora_llegada: '09:00',
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('la llegada como la devuelve la base (HH:MM:SS) vale y queda en HH:MM', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '08:30:00',
      observaciones: 'Fiebre a media mañana',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.hora_llegada).toBe('08:30')
  })

  it('una hora mal formada sigue fallando', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '8:30',
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('ausente sin horas es válido', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'ausente',
      hora_llegada: null,
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('observaciones > 500 caracteres falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '09:00',
      observaciones: 'x'.repeat(501),
    })
    expect(r.success).toBe(false)
  })
})
