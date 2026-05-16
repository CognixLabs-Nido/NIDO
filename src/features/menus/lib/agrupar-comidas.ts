import type { MomentoComida, TipoPlatoComida } from '../types'

/**
 * Estructura mínima que necesita el agrupador. Compatible con
 * `ComidaRow` de F3 (los campos extra de F4.5b son opcionales).
 */
export interface ComidaAgrupable {
  id: string
  momento: MomentoComida
  hora: string | null
  cantidad: string
  descripcion: string | null
  observaciones: string | null
  tipo_plato?: TipoPlatoComida | null
  menu_dia_id?: string | null
}

/**
 * Grupo de comidas por momento. Caso 1 fila: render lineal (F3 clásico
 * o F4.5b con `tipo_plato='unico'`). Caso N filas con tipo_plato no
 * nulo: render desglosado por plato. Caso mezcla (legacy + nuevo): se
 * mantienen todas las filas, las legacy sin tipo_plato se renderizan
 * primero como "fila simple del momento" y luego las que sí tienen
 * tipo_plato como platos individuales.
 */
export interface GrupoComidasMomento {
  momento: MomentoComida
  /** Filas sin `tipo_plato` (legacy F3 o registro individual genérico). */
  filasGenericas: ComidaAgrupable[]
  /**
   * Filas con `tipo_plato` no nulo, en orden fijo (primer_plato →
   * segundo_plato → postre → unico).
   */
  platos: ComidaAgrupable[]
}

const ORDEN_MOMENTO: Record<MomentoComida, number> = {
  desayuno: 0,
  media_manana: 1,
  comida: 2,
  merienda: 3,
}

const ORDEN_PLATO: Record<TipoPlatoComida, number> = {
  primer_plato: 0,
  segundo_plato: 1,
  postre: 2,
  unico: 3,
}

/**
 * Agrupa una lista plana de comidas por `momento` y dentro de cada
 * momento separa entre `filasGenericas` (sin tipo_plato) y `platos`
 * (con tipo_plato no nulo, ordenados por tipo). Devuelve solo los
 * momentos que tienen al menos una fila.
 *
 * Preserva la compatibilidad con F3 sin sorpresas: una comida pre-F4.5b
 * llega aquí con `tipo_plato=null/undefined` y cae en `filasGenericas`.
 * El renderer F3 clásico la pinta como antes.
 */
export function agruparComidasPorMomento(comidas: ComidaAgrupable[]): GrupoComidasMomento[] {
  const grupos = new Map<MomentoComida, GrupoComidasMomento>()

  for (const c of comidas) {
    let g = grupos.get(c.momento)
    if (!g) {
      g = { momento: c.momento, filasGenericas: [], platos: [] }
      grupos.set(c.momento, g)
    }
    if (c.tipo_plato == null) {
      g.filasGenericas.push(c)
    } else {
      g.platos.push(c)
    }
  }

  // Orden interno: filasGenericas por hora (igual que F3), platos por tipo.
  for (const g of grupos.values()) {
    g.filasGenericas.sort(comparaPorHora)
    g.platos.sort((a, b) => ORDEN_PLATO[a.tipo_plato!] - ORDEN_PLATO[b.tipo_plato!])
  }

  return Array.from(grupos.values()).sort(
    (a, b) => ORDEN_MOMENTO[a.momento] - ORDEN_MOMENTO[b.momento]
  )
}

function comparaPorHora(a: ComidaAgrupable, b: ComidaAgrupable): number {
  if (a.hora === b.hora) return 0
  if (a.hora === null) return -1
  if (b.hora === null) return 1
  return a.hora < b.hora ? -1 : 1
}
