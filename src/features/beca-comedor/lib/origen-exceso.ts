/**
 * PR-1c: de dónde viene un exceso (`beca_comedor_desborde.origen`) o su transferencia: la beca que
 * supera la cuota (el motor) o el cheque guardería / ticket restaurant que supera el recibo. Antes
 * de aplicar `20261119120000` la columna no existe y todo es de beca: quien la lee lo hace con
 * `select('*')` y la estrecha aquí, así el código vale antes y después de la migración.
 */
export type OrigenExceso = 'beca' | 'cheque'

export function origenExceso(fila: { origen?: string | null }): OrigenExceso {
  return fila.origen === 'cheque' ? 'cheque' : 'beca'
}
