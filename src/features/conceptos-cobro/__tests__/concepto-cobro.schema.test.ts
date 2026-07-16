import { describe, expect, it } from 'vitest'

import { conceptoCobroSchema, type ConceptoCobroInput } from '../schemas/concepto-cobro'

// F-4-0: modelo único. Base válida (cobro fijo mensual por niño); cada test sobreescribe.
const base: ConceptoCobroInput = {
  nombre: 'Cuota',
  signo: 1,
  tipo_valor: 'fijo',
  tipo_concepto: 'mensual',
  ambito: 'nino',
  aplicacion: 'manual',
  importe_euros: 290,
  porcentaje: null,
  servicio: null,
  concepto_base_id: null,
  activo: true,
}

const parse = (over: Partial<ConceptoCobroInput>) =>
  conceptoCobroSchema.safeParse({ ...base, ...over })

describe('conceptoCobroSchema — modelo único (fijo/porcentaje/descuento)', () => {
  it('cobro fijo mensual por niño es válido', () => {
    expect(parse({}).success).toBe(true)
  })

  it('fijo sin importe falla (importe_requerido)', () => {
    const r = parse({ tipo_valor: 'fijo', importe_euros: null })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('conceptos_cobro.validation.importe_requerido')
  })

  it('porcentaje sin porcentaje falla (porcentaje_requerido)', () => {
    const r = parse({ tipo_valor: 'porcentaje', importe_euros: null, porcentaje: null })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('conceptos_cobro.validation.porcentaje_requerido')
  })

  it('descuento porcentual con concepto base es válido', () => {
    const r = parse({
      signo: -1,
      tipo_valor: 'porcentaje',
      importe_euros: null,
      porcentaje: 10,
      concepto_base_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(r.success).toBe(true)
  })

  it('descuento porcentual SIN concepto base falla (concepto_base_requerido)', () => {
    const r = parse({
      signo: -1,
      tipo_valor: 'porcentaje',
      importe_euros: null,
      porcentaje: 10,
      concepto_base_id: null,
    })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('conceptos_cobro.validation.concepto_base_requerido')
  })

  it('un cobro (no descuento porcentual) con concepto base falla (concepto_base_no_permitido)', () => {
    const r = parse({ concepto_base_id: '11111111-1111-4111-8111-111111111111' })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe(
        'conceptos_cobro.validation.concepto_base_no_permitido'
      )
  })

  it('un descuento FIJO no lleva concepto base (válido sin base)', () => {
    const r = parse({ signo: -1, tipo_valor: 'fijo', importe_euros: 5, concepto_base_id: null })
    expect(r.success).toBe(true)
  })

  it('diario exige servicio', () => {
    expect(parse({ tipo_concepto: 'diario', servicio: null }).success).toBe(false)
    expect(parse({ tipo_concepto: 'diario', importe_euros: 6, servicio: 'comedor' }).success).toBe(
      true
    )
  })

  it('importe negativo / porcentaje >100 fallan', () => {
    expect(parse({ importe_euros: -1 }).success).toBe(false)
    expect(parse({ tipo_valor: 'porcentaje', importe_euros: null, porcentaje: 150 }).success).toBe(
      false
    )
  })

  it('importe NaN (input vacío) se trata como ausente y falla', () => {
    expect(parse({ importe_euros: Number.NaN }).success).toBe(false)
  })

  it('aplicacion automatico y manual son válidos', () => {
    expect(parse({ aplicacion: 'automatico' }).success).toBe(true)
    expect(parse({ aplicacion: 'manual' }).success).toBe(true)
  })

  it('aplicacion inválida falla (aplicacion_invalido)', () => {
    // @ts-expect-error valor fuera del enum a propósito
    const r = parse({ aplicacion: 'otra' })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(
        r.error.issues.some((i) => i.message === 'conceptos_cobro.validation.aplicacion_invalido')
      ).toBe(true)
  })

  it('aplicacion ausente falla (requerida; el default "manual" lo dan form + columna)', () => {
    const sinAplicacion: Record<string, unknown> = { ...base }
    delete sinAplicacion.aplicacion
    expect(conceptoCobroSchema.safeParse(sinAplicacion).success).toBe(false)
  })
})
