import { describe, expect, it } from 'vitest'

import { admiteImportePropio } from '../importe-propio'

// PR-6: exactamente donde `generar_recibos_mes` lee `importe_override_centimos`.
describe('admiteImportePropio', () => {
  it.each([
    ['fijo', 'mensual', true],
    ['fijo', 'diario', true],
    ['fijo', 'esporadico', false],
    ['porcentaje', 'mensual', false],
    ['porcentaje', 'diario', false],
  ] as const)('%s · %s → %s', (tipo_valor, tipo_concepto, esperado) => {
    expect(admiteImportePropio({ tipo_valor, tipo_concepto })).toBe(esperado)
  })
})
