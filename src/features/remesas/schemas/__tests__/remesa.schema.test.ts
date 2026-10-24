import { describe, expect, it } from 'vitest'

import {
  cobrarConChequeSchema,
  crearCobroDialogSchema,
  crearRemesaSchema,
  datosAcreedorSchema,
  marcarCobradoManualSchema,
  marcarReciboDevueltoSchema,
  marcarRemesaEnviadaSchema,
  resolverDevolucionSchema,
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
  it('marcarReciboDevueltoSchema (PR-2): uuid, fecha y gastos ≥ 0 (0 si no hay)', () => {
    const base = { reciboId: UUID, fecha: '2026-10-20', gastos_euros: 3.5 }
    expect(marcarReciboDevueltoSchema.safeParse(base).success).toBe(true)
    expect(marcarReciboDevueltoSchema.safeParse({ ...base, gastos_euros: 0 }).success).toBe(true)
    expect(marcarReciboDevueltoSchema.safeParse({ ...base, reciboId: 'x' }).success).toBe(false)
    expect(marcarReciboDevueltoSchema.safeParse({ ...base, gastos_euros: -1 }).success).toBe(false)
    expect(
      marcarReciboDevueltoSchema.safeParse({ ...base, gastos_euros: Number.NaN }).success
    ).toBe(false)
    expect(marcarReciboDevueltoSchema.safeParse({ ...base, fecha: '20/10/2026' }).success).toBe(
      false
    )
    // Sin gastos no se registra: hay que decir 0.
    expect(
      marcarReciboDevueltoSchema.safeParse({ reciboId: UUID, fecha: '2026-10-20' }).success
    ).toBe(false)
  })

  it('marcarCobradoManualSchema (PR-1a): uuid, forma efectivo o transferencia, fecha y nota ≤ 500', () => {
    const base = { reciboId: UUID, forma: 'efectivo', fecha: '2026-10-20' }
    expect(marcarCobradoManualSchema.safeParse(base).success).toBe(true)
    expect(
      marcarCobradoManualSchema.safeParse({ ...base, forma: 'transferencia', nota: 'x' }).success
    ).toBe(true)
    expect(marcarCobradoManualSchema.safeParse({ reciboId: UUID }).success).toBe(false)
    expect(marcarCobradoManualSchema.safeParse({ ...base, reciboId: 'x' }).success).toBe(false)
    expect(marcarCobradoManualSchema.safeParse({ ...base, forma: 'sepa' }).success).toBe(false)
    // El cheque pide su importe: va por cobrarConChequeSchema, no por aquí (PR-1b).
    expect(
      marcarCobradoManualSchema.safeParse({ ...base, forma: 'cheque_guarderia' }).success
    ).toBe(false)
    expect(marcarCobradoManualSchema.safeParse({ ...base, fecha: '20/10/2026' }).success).toBe(
      false
    )
    expect(marcarCobradoManualSchema.safeParse({ ...base, nota: 'x'.repeat(501) }).success).toBe(
      false
    )
  })

  it('cobrarConChequeSchema (PR-1b): importe > 0, fecha, nota ≤ 500 y la diferencia sin cheque', () => {
    const base = { reciboId: UUID, importe_euros: 100, fecha: '2026-10-20' }
    expect(cobrarConChequeSchema.safeParse(base).success).toBe(true)
    for (const metodoDiferencia of ['sepa', 'efectivo', 'transferencia']) {
      expect(cobrarConChequeSchema.safeParse({ ...base, metodoDiferencia }).success).toBe(true)
    }
    expect(
      cobrarConChequeSchema.safeParse({ ...base, metodoDiferencia: 'cheque_guarderia' }).success
    ).toBe(false)
    expect(cobrarConChequeSchema.safeParse({ ...base, importe_euros: 0 }).success).toBe(false)
    expect(cobrarConChequeSchema.safeParse({ ...base, importe_euros: -1 }).success).toBe(false)
    expect(cobrarConChequeSchema.safeParse({ ...base, fecha: '20/10/2026' }).success).toBe(false)
    expect(cobrarConChequeSchema.safeParse({ ...base, nota: 'x'.repeat(501) }).success).toBe(false)
  })

  it('crearCobroDialogSchema (PR-1b): con cheque, importe obligatorio, ≤ total, y método si queda algo', () => {
    const schema = crearCobroDialogSchema(11000)
    const base = { reciboId: UUID, forma: 'cheque_guarderia', fecha: '2026-10-20' }
    const error = (v: object) => {
      const r = schema.safeParse({ ...base, ...v })
      return r.success ? null : r.error.issues[0]?.message
    }
    // Premisa: sin cheque no pide importe ni método.
    expect(error({ forma: 'efectivo' })).toBeNull()
    expect(error({ importe_euros: 110 })).toBeNull()
    expect(error({})).toBe('remesas.validation.importe_cheque_invalido')
    expect(error({ importe_euros: 0 })).toBe('remesas.validation.importe_cheque_invalido')
    expect(error({ importe_euros: 110.01 })).toBe('remesas.errors.cheque_supera_recibo')
    expect(error({ importe_euros: 100 })).toBe('remesas.validation.falta_metodo_diferencia')
    expect(error({ importe_euros: 100, metodoDiferencia: 'efectivo' })).toBeNull()
  })

  it('resolverDevolucionSchema (PR-2 y PR-14): banco, efectivo, transferencia o siguiente recibo; el cobro pide fecha', () => {
    expect(resolverDevolucionSchema.safeParse({ reciboId: UUID, salida: 'banco' }).success).toBe(
      true
    )
    expect(
      resolverDevolucionSchema.safeParse({
        reciboId: UUID,
        salida: 'efectivo',
        fecha: '2026-10-20',
      }).success
    ).toBe(true)
    const sinFecha = resolverDevolucionSchema.safeParse({ reciboId: UUID, salida: 'transferencia' })
    expect(sinFecha.success).toBe(false)
    expect(sinFecha.error?.issues[0]?.message).toBe('remesas.validation.fecha_cobro_invalida')
    // PR-14: el siguiente recibo es la cuarta salida, y como el banco no pide fecha.
    expect(
      resolverDevolucionSchema.safeParse({ reciboId: UUID, salida: 'siguiente_recibo' }).success
    ).toBe(true)
    // El cheque y el SEPA no son salidas de una devolución.
    for (const salida of ['cheque_guarderia', 'sepa']) {
      expect(
        resolverDevolucionSchema.safeParse({ reciboId: UUID, salida, fecha: '2026-10-20' }).success
      ).toBe(false)
    }
  })
})
