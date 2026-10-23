import { describe, expect, it } from 'vitest'

import { admiteImportePropio, admitePorcentajePropio } from '../importe-propio'

const BASE = '11111111-1111-4111-8111-111111111111'

// PR-6: exactamente donde `generar_recibos_mes` lee `importe_override_centimos`. PR-8: también
// un descuento porcentual con base, al que su importe propio hace fijo.
describe('admiteImportePropio', () => {
  it.each([
    ['fijo', 'mensual', 1, null, true],
    ['fijo', 'diario', 1, null, true],
    ['fijo', 'esporadico', 1, null, false],
    ['porcentaje', 'mensual', 1, null, false],
    ['porcentaje', 'diario', 1, null, false],
    ['porcentaje', 'mensual', -1, BASE, true],
    ['porcentaje', 'esporadico', -1, BASE, false],
  ] as const)(
    '%s · %s · signo %s · base %s → %s',
    (tipo_valor, tipo_concepto, signo, base, esperado) => {
      expect(
        admiteImportePropio({ tipo_valor, tipo_concepto, signo, concepto_base_id: base })
      ).toBe(esperado)
    }
  )
})

// PR-8: el porcentaje propio solo en un descuento con base que pasa por el motor; es lo que
// exige el trigger `asignacion_porcentaje_con_base`.
describe('admitePorcentajePropio', () => {
  it.each([
    ['fijo', 'mensual', -1, BASE, true],
    ['porcentaje', 'mensual', -1, BASE, true],
    ['fijo', 'diario', -1, BASE, true],
    ['fijo', 'mensual', -1, null, false],
    ['fijo', 'mensual', 1, null, false],
    ['fijo', 'esporadico', -1, BASE, false],
  ] as const)(
    '%s · %s · signo %s · base %s → %s',
    (tipo_valor, tipo_concepto, signo, base, esperado) => {
      expect(
        admitePorcentajePropio({ tipo_valor, tipo_concepto, signo, concepto_base_id: base })
      ).toBe(esperado)
    }
  )
})
