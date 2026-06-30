import { describe, expect, it } from 'vitest'

import { conceptoCobroSchema } from '../schemas/concepto-cobro'

const base = { nombre: 'Cuota', activo: true }

describe('conceptoCobroSchema — coherencia precio/servicio por tipo', () => {
  it('mensual con precio mensual es válido', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'mensual',
      precio_mensual_euros: 290,
      precio_diario_euros: null,
      servicio: null,
    })
    expect(r.success).toBe(true)
  })

  it('mensual sin precio mensual falla', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'mensual',
      precio_mensual_euros: null,
      precio_diario_euros: null,
      servicio: null,
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('conceptos_cobro.validation.precio_requerido')
    }
  })

  it('diario con precio diario + servicio es válido', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'diario',
      precio_mensual_euros: null,
      precio_diario_euros: 6,
      servicio: 'comedor',
    })
    expect(r.success).toBe(true)
  })

  it('diario sin servicio falla', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'diario',
      precio_mensual_euros: null,
      precio_diario_euros: 6,
      servicio: null,
    })
    expect(r.success).toBe(false)
  })

  it('diario sin precio diario falla', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'diario',
      precio_mensual_euros: null,
      precio_diario_euros: null,
      servicio: 'comedor',
    })
    expect(r.success).toBe(false)
  })

  it('esporádico con precio mensual (precio único) es válido', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'esporadico',
      precio_mensual_euros: 45,
      precio_diario_euros: null,
      servicio: null,
    })
    expect(r.success).toBe(true)
  })

  it('precio NaN (input vacío) se trata como ausente y falla si es requerido', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'mensual',
      precio_mensual_euros: Number.NaN,
      precio_diario_euros: null,
      servicio: null,
    })
    expect(r.success).toBe(false)
  })

  it('precio negativo falla', () => {
    const r = conceptoCobroSchema.safeParse({
      ...base,
      tipo_concepto: 'mensual',
      precio_mensual_euros: -1,
      precio_diario_euros: null,
      servicio: null,
    })
    expect(r.success).toBe(false)
  })
})
