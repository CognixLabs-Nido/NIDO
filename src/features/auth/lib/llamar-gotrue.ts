import 'server-only'

import type { AuthError } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'

/**
 * PR-A (robustez de altas) — envoltorio defensivo de una llamada a GoTrue (Supabase Auth).
 *
 * Las server actions del flujo de altas trataban GoTrue como si no pudiera fallar: el
 * patrón Result cubría el error DEVUELTO (`{ data, error }`) pero NO el LANZADO. `supabase-js`
 * re-lanza los errores que no son de Auth (timeout, 5xx, red), así que una latencia puntual
 * de GoTrue rechazaba la promesa de la action → se tragaba en el handler cliente (BUG 1).
 *
 * `llamarGoTrue` ejecuta el thunk y **NUNCA lanza**: distingue dos naturalezas de fallo:
 *  - `indisponible=true`  → el SDK LANZÓ (infra: timeout/5xx/red). El caller mapea a la clave
 *    i18n `auth.invitation.errors.servicio_cuentas_no_disponible` ("reinténtalo").
 *  - `indisponible=false` → respuesta normal; `error` es el `AuthError` DEVUELTO (o `null`).
 *    El caller mantiene su manejo actual del error (dup → `email_already_registered`, etc.).
 *
 * En éxito, `data` es idéntico a lo que devolvería la llamada directa. NO añade timeout ni
 * reintentos/backoff (eso es PR-F): aquí solo se captura el throw.
 */
/** Forma mínima común de una respuesta de GoTrue (`{ data, error }`), sea unión discriminada. */
type RespuestaGoTrue = { data: unknown; error: AuthError | null }

/**
 * Envoltorio del resultado: preserva la unión original `R` de la respuesta GoTrue (o la
 * degrada a `{ data: null, error: null }` si el SDK lanzó) y añade `indisponible`.
 */
export type ResultadoGoTrue<R> = (R | { data: null; error: null }) & { indisponible: boolean }

export async function llamarGoTrue<R extends RespuestaGoTrue>(
  etiqueta: string,
  fn: () => Promise<R>
): Promise<ResultadoGoTrue<R>> {
  try {
    const res = await fn()
    return { ...res, indisponible: false } as ResultadoGoTrue<R>
  } catch (e) {
    // supabase-js re-lanza los errores NO-Auth (fetch failed, timeout, 5xx). Sin PII.
    logger.warn(`llamarGoTrue:${etiqueta} lanzó`, e instanceof Error ? e.message : String(e))
    return { data: null, error: null, indisponible: true } as ResultadoGoTrue<R>
  }
}
