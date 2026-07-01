import { describe, expect, it } from 'vitest'

import {
  crearRegiroSchema,
  crearRemesaSchema,
  datosAcreedorSchema,
  gastosDevolucionSchema,
  marcarCobradoManualSchema,
  marcarReciboDevueltoSchema,
  marcarRemesaEnviadaSchema,
} from '../remesa'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('crearRemesaSchema', () => {
  it('acepta un periodo válido con al menos un recibo', () => {
    const r = crearRemesaSchema.safeParse({ anio: 2026, mes: 7, reciboIds: [UUID] })
    expect(r.success).toBe(true)
  })

  it('rechaza lista de recibos vacía', () => {
    const r = crearRemesaSchema.safeParse({ anio: 2026, mes: 7, reciboIds: [] })
    expect(r.success).toBe(false)
  })

  it('rechaza mes fuera de rango', () => {
    expect(crearRemesaSchema.safeParse({ anio: 2026, mes: 13, reciboIds: [UUID] }).success).toBe(
      false
    )
  })
})

describe('marcarRemesaEnviadaSchema', () => {
  it('exige un uuid de remesa', () => {
    expect(marcarRemesaEnviadaSchema.safeParse({ remesaId: UUID }).success).toBe(true)
    expect(marcarRemesaEnviadaSchema.safeParse({ remesaId: 'x' }).success).toBe(false)
  })
})

describe('datosAcreedorSchema', () => {
  it('acepta CID + BIC válidos e IBAN vacío (preservar)', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00ZZZ00000000000',
      bic_acreedor: 'CAIXESBBXXX',
      iban: '',
    })
    expect(r.success).toBe(true)
  })

  it('acepta BIC vacío', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00ZZZ00000000000',
      bic_acreedor: '',
      iban: '',
    })
    expect(r.success).toBe(true)
  })

  it('rechaza CID demasiado corto', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00',
      bic_acreedor: '',
      iban: '',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza BIC con longitud distinta de 8 u 11', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00ZZZ00000000000',
      bic_acreedor: 'ABC123',
      iban: '',
    })
    expect(r.success).toBe(false)
  })

  it('rechaza IBAN con longitud no SEPA cuando se aporta', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00ZZZ00000000000',
      bic_acreedor: '',
      iban: 'ES12',
    })
    expect(r.success).toBe(false)
  })

  it('acepta un IBAN de longitud válida', () => {
    const r = datosAcreedorSchema.safeParse({
      identificador_acreedor: 'ES00ZZZ00000000000',
      bic_acreedor: '',
      iban: 'ES9121000418450200051332',
    })
    expect(r.success).toBe(true)
  })
})

describe('esquemas de devolución (B-6)', () => {
  it('marcarReciboDevueltoSchema exige uuid', () => {
    expect(marcarReciboDevueltoSchema.safeParse({ reciboId: UUID }).success).toBe(true)
    expect(marcarReciboDevueltoSchema.safeParse({ reciboId: 'x' }).success).toBe(false)
  })

  it('marcarCobradoManualSchema exige uuid', () => {
    expect(marcarCobradoManualSchema.safeParse({ reciboId: UUID }).success).toBe(true)
  })

  it('crearRegiroSchema exige uuid', () => {
    expect(crearRegiroSchema.safeParse({ reciboId: UUID }).success).toBe(true)
  })

  it('gastosDevolucionSchema: importe > 0 y método válido', () => {
    expect(
      gastosDevolucionSchema.safeParse({ reciboId: UUID, importe_euros: 3.5, metodo: 'sepa' })
        .success
    ).toBe(true)
    expect(
      gastosDevolucionSchema.safeParse({ reciboId: UUID, importe_euros: 0, metodo: 'sepa' }).success
    ).toBe(false)
    expect(
      gastosDevolucionSchema.safeParse({ reciboId: UUID, importe_euros: 3, metodo: 'cheque' })
        .success
    ).toBe(false)
  })
})
