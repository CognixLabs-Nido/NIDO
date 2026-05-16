import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'

import {
  aplicarTipoARangoSchema,
  eliminarDiaCentroSchema,
  upsertDiaCentroSchema,
} from '../schemas/dia-centro'

describe('upsertDiaCentroSchema', () => {
  const base = () => ({
    centro_id: randomUUID(),
    fecha: '2026-06-15',
    tipo: 'festivo' as const,
    observaciones: 'San Vicente Mártir',
  })

  it('acepta input válido', () => {
    expect(upsertDiaCentroSchema.safeParse(base()).success).toBe(true)
  })

  it('rechaza tipo inválido', () => {
    const bad = { ...base(), tipo: 'comida' as unknown as 'festivo' }
    expect(upsertDiaCentroSchema.safeParse(bad).success).toBe(false)
  })

  it('rechaza fecha mal formada', () => {
    const bad = { ...base(), fecha: '15-06-2026' }
    expect(upsertDiaCentroSchema.safeParse(bad).success).toBe(false)
  })

  it('observaciones > 500 chars → falla', () => {
    const bad = { ...base(), observaciones: 'a'.repeat(501) }
    expect(upsertDiaCentroSchema.safeParse(bad).success).toBe(false)
  })

  it('observaciones=null aceptado', () => {
    const ok = { ...base(), observaciones: null }
    expect(upsertDiaCentroSchema.safeParse(ok).success).toBe(true)
  })
})

describe('aplicarTipoARangoSchema', () => {
  const base = () => ({
    centro_id: randomUUID(),
    desde: '2026-08-01',
    hasta: '2026-08-31',
    tipo: 'escuela_verano' as const,
    observaciones: null,
  })

  it('acepta rango válido', () => {
    expect(aplicarTipoARangoSchema.safeParse(base()).success).toBe(true)
  })

  it('rechaza rango invertido (hasta < desde)', () => {
    const bad = { ...base(), desde: '2026-08-31', hasta: '2026-08-01' }
    const res = aplicarTipoARangoSchema.safeParse(bad)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].message).toBe('calendario.validation.rango_invertido')
    }
  })

  it('rechaza span > 366 días', () => {
    const bad = { ...base(), desde: '2026-01-01', hasta: '2027-12-31' }
    const res = aplicarTipoARangoSchema.safeParse(bad)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error.issues[0].message).toBe('calendario.validation.rango_demasiado_grande')
    }
  })

  it('acepta span de exactamente 366 días (año bisiesto completo)', () => {
    const ok = { ...base(), desde: '2024-01-01', hasta: '2024-12-31' }
    expect(aplicarTipoARangoSchema.safeParse(ok).success).toBe(true)
  })
})

describe('eliminarDiaCentroSchema', () => {
  it('acepta input válido', () => {
    const ok = { centro_id: randomUUID(), fecha: '2026-06-15' }
    expect(eliminarDiaCentroSchema.safeParse(ok).success).toBe(true)
  })

  it('rechaza centro_id no-UUID', () => {
    const bad = { centro_id: 'not-a-uuid', fecha: '2026-06-15' }
    expect(eliminarDiaCentroSchema.safeParse(bad).success).toBe(false)
  })
})
