import type { Database } from '@/types/database'

type TipoConcepto = Database['public']['Enums']['tipo_concepto']

interface ConceptoValor {
  tipo_valor: string
  tipo_concepto: TipoConcepto
  signo: number
  concepto_base_id: string | null
}

/**
 * PR-8: ¿admite este concepto un PORCENTAJE propio en la asignación? Solo un descuento con base
 * que el motor cobra cada mes: `generar_recibos_mes` lo calcula sobre la base del concepto (la
 * escolaridad, en el descuento por hermano). Sin base no habría sobre qué calcularlo; la BD lo
 * impide también (trigger `asignacion_porcentaje_con_base`).
 */
export function admitePorcentajePropio(c: ConceptoValor): boolean {
  return c.tipo_concepto !== 'esporadico' && c.signo === -1 && c.concepto_base_id != null
}

/**
 * PR-6: ¿admite este concepto un importe propio en la asignación? Uno de importe FIJO que el
 * motor cobra cada mes (mensual o diario), y desde PR-8 también un descuento porcentual con base:
 * su importe propio lo hace fijo para esa familia. El esporádico no pasa por el motor; ponérselo
 * sería un importe que no se cobra nunca.
 */
export function admiteImportePropio(c: ConceptoValor): boolean {
  return c.tipo_concepto !== 'esporadico' && (c.tipo_valor === 'fijo' || admitePorcentajePropio(c))
}
