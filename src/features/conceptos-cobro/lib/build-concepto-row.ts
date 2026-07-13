import { eurosACentimos } from '@/shared/lib/format-money'

import type { ConceptoCobroInput } from '../schemas/concepto-cobro'

/**
 * F-4-0 — Traduce el input del formulario (euros/%) a las columnas del modelo único
 * de `conceptos_cobro`. Aplica las MISMAS reglas que el CHECK `conceptos_cobro_modelo_valor`:
 *  · fijo → importe_centimos (porcentaje_bp NULL) ; porcentaje → porcentaje_bp (importe NULL).
 *  · servicio solo si diario.
 *  · concepto_base_id solo si descuento porcentual (signo=−1 ∧ porcentaje); NULL si no.
 * Devuelve las columnas comunes a INSERT y UPDATE (sin centro_id, que solo va en INSERT).
 */
export function buildConceptoRow(input: ConceptoCobroInput) {
  const esFijo = input.tipo_valor === 'fijo'
  const esDescuentoPorcentual = input.signo === -1 && input.tipo_valor === 'porcentaje'
  return {
    nombre: input.nombre,
    tipo_concepto: input.tipo_concepto,
    signo: input.signo,
    ambito: input.ambito,
    tipo_valor: input.tipo_valor,
    importe_centimos:
      esFijo && input.importe_euros != null ? eurosACentimos(input.importe_euros) : null,
    // Porcentaje de la UI (%) → basis points (10% → 1000). Redondeo entero (bp es integer).
    porcentaje_bp: !esFijo && input.porcentaje != null ? Math.round(input.porcentaje * 100) : null,
    servicio: input.tipo_concepto === 'diario' ? input.servicio : null,
    concepto_base_id: esDescuentoPorcentual ? input.concepto_base_id : null,
    activo: input.activo,
  }
}
