import type { Json } from '@/types/database'

import type { EstructuraInforme, RespuestasInforme, ValoracionItem } from '../types'

const VALORACIONES: readonly ValoracionItem[] = ['conseguido', 'en_proceso', 'no_iniciado']

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

/** Serializa las respuestas (item_id → {valoracion, comentario}) a `Json`. */
export function respuestasToJson(r: RespuestasInforme): Json {
  return r as unknown as Json
}

/** Lee las respuestas del JSONB de forma defensiva (normaliza forma y tipos). */
export function parseRespuestas(j: Json | null): RespuestasInforme {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
  const out: RespuestasInforme = {}
  for (const [itemId, raw] of Object.entries(j)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const valoracion = (raw as { [k: string]: Json | undefined }).valoracion
    const comentario = (raw as { [k: string]: Json | undefined }).comentario
    if (typeof valoracion === 'string' && (VALORACIONES as string[]).includes(valoracion)) {
      out[itemId] = {
        valoracion: valoracion as ValoracionItem,
        ...(typeof comentario === 'string' && comentario.length > 0 ? { comentario } : {}),
      }
    }
  }
  return out
}

/** Todos los ids de ítem de una estructura (snapshot), en orden. */
export function idsDeItems(e: EstructuraInforme): string[] {
  return e.flatMap((area) => area.items.map((it) => it.id))
}

/**
 * ¿Están TODOS los ítems del snapshot valorados? (regla de publicación, Q9).
 * Comentarios y observaciones generales son opcionales.
 */
export function todosValorados(e: EstructuraInforme, r: RespuestasInforme): boolean {
  return idsDeItems(e).every((id) => !!r[id]?.valoracion)
}
