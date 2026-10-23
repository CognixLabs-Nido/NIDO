import type { Database } from '@/types/database'

type TipoConcepto = Database['public']['Enums']['tipo_concepto']

/**
 * PR-6: ¿admite este concepto un importe propio en la asignación? Solo uno de importe FIJO que el
 * motor cobra cada mes (mensual o diario): es lo único en lo que `generar_recibos_mes` lee
 * `importe_override_centimos`. En uno porcentual el motor no lo usa, y el esporádico no pasa por
 * el motor; ponérselo sería un importe que no se cobra nunca.
 */
export function admiteImportePropio(c: {
  tipo_valor: string
  tipo_concepto: TipoConcepto
}): boolean {
  return c.tipo_valor === 'fijo' && c.tipo_concepto !== 'esporadico'
}
