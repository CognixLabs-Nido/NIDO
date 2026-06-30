import { describe, expect, it } from 'vitest'

import { cerrarMesSchema, reciboEsporadicoSchema } from '../schemas/cierre'

const NINO = '22222222-2222-4222-9222-222222222222'

describe('cierre — cerrarMesSchema', () => {
  it('acepta un periodo válido', () => {
    expect(cerrarMesSchema.safeParse({ anio: 2026, mes: 6 }).success).toBe(true)
  })
  it('rechaza mes fuera de rango', () => {
    expect(cerrarMesSchema.safeParse({ anio: 2026, mes: 13 }).success).toBe(false)
  })
})

describe('cierre — reciboEsporadicoSchema', () => {
  const base = {
    ninoId: NINO,
    anio: 2026,
    mes: 6,
    concepto: 'Uniforme',
    metodo: null,
    lineas: [{ descripcion: 'Babi', cantidad: 1, importe_euros: 12 }],
  }

  it('acepta un recibo esporádico válido (sin método)', () => {
    expect(reciboEsporadicoSchema.safeParse(base).success).toBe(true)
  })

  it('acepta método sepa', () => {
    expect(reciboEsporadicoSchema.safeParse({ ...base, metodo: 'sepa' }).success).toBe(true)
  })

  it('rechaza cheque_guarderia como método (ya no existe)', () => {
    expect(reciboEsporadicoSchema.safeParse({ ...base, metodo: 'cheque_guarderia' }).success).toBe(
      false
    )
  })

  it('rechaza sin líneas', () => {
    expect(reciboEsporadicoSchema.safeParse({ ...base, lineas: [] }).success).toBe(false)
  })

  it('rechaza cantidad < 1', () => {
    const r = reciboEsporadicoSchema.safeParse({
      ...base,
      lineas: [{ descripcion: 'Babi', cantidad: 0, importe_euros: 12 }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza concepto vacío', () => {
    expect(reciboEsporadicoSchema.safeParse({ ...base, concepto: '' }).success).toBe(false)
  })

  it('rechaza ninoId no uuid', () => {
    expect(reciboEsporadicoSchema.safeParse({ ...base, ninoId: 'x' }).success).toBe(false)
  })
})
