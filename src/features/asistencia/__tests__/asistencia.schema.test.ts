import { describe, expect, it } from 'vitest'

import { asistenciaInputSchema } from '../schemas/asistencia'

describe('asistencia — schema Zod', () => {
  it('presente sin hora_llegada falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: null,
      hora_salida: null,
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
      hora_salida: null,
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('llegada_tarde sin hora_llegada falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'llegada_tarde',
      hora_llegada: null,
      hora_salida: null,
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('salida_temprana sin hora_salida falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'salida_temprana',
      hora_llegada: '09:00',
      hora_salida: null,
      observaciones: null,
    })
    expect(r.success).toBe(false)
  })

  it('hora_salida anterior a hora_llegada falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'salida_temprana',
      hora_llegada: '09:00',
      hora_salida: '08:30',
      observaciones: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('asistencia.validation.salida_anterior_llegada')
    }
  })

  it('ausente sin horas es válido', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'ausente',
      hora_llegada: null,
      hora_salida: null,
      observaciones: null,
    })
    expect(r.success).toBe(true)
  })

  it('observaciones > 500 caracteres falla', () => {
    const r = asistenciaInputSchema.safeParse({
      estado: 'presente',
      hora_llegada: '09:00',
      hora_salida: null,
      observaciones: 'x'.repeat(501),
    })
    expect(r.success).toBe(false)
  })
})
