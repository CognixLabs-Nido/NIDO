import type { CantidadComida } from '../types'

/**
 * Mapeo entre la escala visible 1-5 y el ENUM `cantidad_comida` (F3).
 *
 * La UI del pase de lista comida (F4.5b) muestra botones 1-5; la BD
 * guarda los 5 valores del enum. Decisión documentada en ADR-0022:
 * no crear un enum nuevo, la verdad de la BD sigue siendo el enum.
 *
 *  1 → nada
 *  2 → poco
 *  3 → mitad
 *  4 → mayoria  (label visible en agenda/informes: "Casi todo")
 *  5 → todo
 */
export const ESCALA_1_5_VALORES = ['nada', 'poco', 'mitad', 'mayoria', 'todo'] as const

export const ESCALA_1_5_OPTIONS: ReadonlyArray<{ value: CantidadComida; label: string }> = [
  { value: 'nada', label: '1' },
  { value: 'poco', label: '2' },
  { value: 'mitad', label: '3' },
  { value: 'mayoria', label: '4' },
  { value: 'todo', label: '5' },
]

/** Devuelve el número 1-5 correspondiente a una cantidad. */
export function cantidadANumero(c: CantidadComida): 1 | 2 | 3 | 4 | 5 {
  switch (c) {
    case 'nada':
      return 1
    case 'poco':
      return 2
    case 'mitad':
      return 3
    case 'mayoria':
      return 4
    case 'todo':
      return 5
  }
}

/** Inverso: número 1-5 → enum. Asume input válido. */
export function numeroACantidad(n: 1 | 2 | 3 | 4 | 5): CantidadComida {
  return ESCALA_1_5_VALORES[n - 1]
}
