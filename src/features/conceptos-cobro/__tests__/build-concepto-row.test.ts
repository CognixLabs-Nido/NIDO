import { describe, expect, it } from 'vitest'

import { buildConceptoRow } from '../lib/build-concepto-row'
import type { ConceptoCobroInput } from '../schemas/concepto-cobro'

// Cobro fijo mensual por niño; cada test sobreescribe lo que necesita.
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
  tarifa_por_anio_nacimiento: false,
}

describe('buildConceptoRow — aplicacion', () => {
  it('propaga aplicacion="automatico" a la fila', () => {
    expect(buildConceptoRow({ ...base, aplicacion: 'automatico' }).aplicacion).toBe('automatico')
  })

  it('propaga aplicacion="manual" a la fila', () => {
    expect(buildConceptoRow({ ...base, aplicacion: 'manual' }).aplicacion).toBe('manual')
  })

  it('mantiene el resto del mapeo de valor (fijo → importe_centimos)', () => {
    const row = buildConceptoRow({ ...base, aplicacion: 'automatico' })
    expect(row.importe_centimos).toBe(29000)
    expect(row.porcentaje_bp).toBeNull()
  })
})

// PR-4: un mensual de cobro fijo por niño puede ser «de comedor»; donde no cabe, el servicio se
// anula igual que el CHECK `conceptos_cobro_modelo_valor` lo rechazaría.
describe('buildConceptoRow — servicio (PR-4)', () => {
  it('premisa: un diario conserva su servicio', () => {
    expect(
      buildConceptoRow({ ...base, tipo_concepto: 'diario', servicio: 'comedor' }).servicio
    ).toBe('comedor')
  })

  it('un mensual de cobro fijo por niño conserva el servicio', () => {
    expect(buildConceptoRow({ ...base, servicio: 'comedor' }).servicio).toBe('comedor')
  })

  it('un mensual sin servicio sigue sin él', () => {
    expect(buildConceptoRow({ ...base, servicio: null }).servicio).toBeNull()
  })

  it.each([
    ['de familia', { ambito: 'familia' as const }],
    ['descuento', { signo: -1 as const, importe_euros: 10 }],
    ['porcentaje', { tipo_valor: 'porcentaje' as const, importe_euros: null, porcentaje: 10 }],
    ['esporádico', { tipo_concepto: 'esporadico' as const }],
  ])('servicio en un mensual %s, o en un esporádico: se anula', (_n, over) => {
    expect(buildConceptoRow({ ...base, ...over, servicio: 'comedor' }).servicio).toBeNull()
  })

  // PR-8: la base va en cualquier descuento (obligatoria en el porcentual, opcional en el fijo)
  // y nunca en un cobro.
  const BASE = '11111111-1111-4111-8111-111111111111'
  it('un descuento fijo conserva su base', () => {
    const row = buildConceptoRow({ ...base, signo: -1, importe_euros: 20, concepto_base_id: BASE })
    expect(row.concepto_base_id).toBe(BASE)
  })

  it('un cobro no lleva base aunque llegue una', () => {
    const row = buildConceptoRow({ ...base, signo: 1, concepto_base_id: BASE })
    expect(row.concepto_base_id).toBeNull()
  })
})
