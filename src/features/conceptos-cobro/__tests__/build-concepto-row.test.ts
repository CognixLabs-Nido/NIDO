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
