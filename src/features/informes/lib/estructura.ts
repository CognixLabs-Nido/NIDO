import type { Json } from '@/types/database'

import type { EstructuraInforme } from '../types'

/**
 * Helpers de (de)serialización de la estructura áreas→ítems entre el view model
 * tipado (`EstructuraInforme`) y la columna `estructura jsonb`. Centraliza el
 * único cast hacia/desde `Json` para no esparcirlo por queries y actions.
 *
 * Módulo neutro (sin `server-only` ni `crypto` de Node): lo consumen tanto el
 * server (query/action) como, en lectura, los componentes.
 */
export function estructuraToJson(e: EstructuraInforme): Json {
  return e as unknown as Json
}

/** Lee la estructura del JSONB de forma defensiva (normaliza forma y tipos). */
export function parseEstructura(j: Json | null): EstructuraInforme {
  if (!Array.isArray(j)) return []
  return j
    .filter(
      (a): a is { [k: string]: Json | undefined } =>
        typeof a === 'object' && a !== null && !Array.isArray(a)
    )
    .map((a) => ({
      titulo: typeof a.titulo === 'string' ? a.titulo : '',
      items: Array.isArray(a.items)
        ? a.items
            .filter(
              (it): it is { [k: string]: Json | undefined } =>
                typeof it === 'object' && it !== null && !Array.isArray(it)
            )
            .map((it) => ({
              id: typeof it.id === 'string' ? it.id : '',
              texto: typeof it.texto === 'string' ? it.texto : '',
            }))
        : [],
    }))
}

/** Total de ítems de una estructura (para el resumen «N áreas · M ítems»). */
export function contarItems(e: EstructuraInforme): number {
  return e.reduce((acc, area) => acc + area.items.length, 0)
}
