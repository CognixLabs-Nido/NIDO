// =============================================================================
// Reintento acotado para llamadas transitorias del harness RLS (auth admin +
// signIn) contra la BD remota compartida. Vive en su PROPIO módulo, SIN efectos
// de import (no crea clientes ni valida env), para poder importarse tanto desde
// `setup.ts` (que sí valida env al cargar) como desde `global-setup.ts` sin
// disparar esa validación. `setup.ts` re-exporta estos símbolos para no romper
// a sus importadores (p. ej. `__tests__/with-retry.test.ts`).
//
// Solo infra de test: si se necesita reintento en producción, se implementa de
// nuevo en el módulo concreto.
// =============================================================================

/** Extrae el `message` de un error heterogéneo (string | Error | { message }). */
function messageOf(err: unknown): string {
  return typeof err === 'string'
    ? err
    : err instanceof Error
      ? err.message
      : typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : ''
}

/**
 * Detecta si un error de Supabase Auth es por rate-limit. Distinguimos entre
 * "demasiados intentos contra el endpoint cloud" (reintentamos) y cualquier
 * otro error real (no reintentamos para no enmascarar bugs).
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false
  const message = messageOf(err)
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  if (status === 429) return true
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return true
  return /rate.?limit/i.test(message)
}

/**
 * Detecta el error de JWT TRANSITORIO del fleet de GoTrue mientras conviven las
 * signing keys legacy (HS256, kidless) y la nueva (ES256): un token kidless llega
 * a un verificador ES256-only y se rechaza con
 *   "invalid JWT: unable to parse or verify signature, unrecognized JWT kid <nil> for algorithm ES256".
 * Es transitorio (otro nodo del fleet valida bien) → reintentable. El patrón
 * concreto (`unrecognized jwt kid` / `unable to … verify signature`) NO coincide
 * con un JWT permanentemente inválido por credenciales, así que no enmascara bugs.
 * Desaparecerá del todo cuando se revoque la HS256 `previously_used` (acción de
 * dashboard, aparte de este harness).
 */
export function isTransientJwtError(err: unknown): boolean {
  if (!err) return false
  const message = messageOf(err)
  return /unrecognized jwt kid|kid <nil>|unable to (parse or )?verify signature/i.test(message)
}

/** Reintentable = rate-limit O el blip de JWT transitorio de la rotación de keys. */
export function isRetryableAuthError(err: unknown): boolean {
  return isRateLimitError(err) || isTransientJwtError(err)
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  shouldRetry?: (err: unknown) => boolean
  /** Hook de sleep inyectable para tests del propio helper. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Ejecuta `fn`. Si lanza un error para el cual `shouldRetry(err) === true`,
 * reintenta hasta `attempts` veces con backoff exponencial (1s, 2s, 4s con
 * `baseDelayMs=1000`). Si el error no es retryable, falla inmediatamente
 * sin reintentar — fundamental para no enmascarar bugs reales.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5
  const baseDelayMs = opts.baseDelayMs ?? 2000
  const shouldRetry = opts.shouldRetry ?? isRateLimitError
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!shouldRetry(err)) throw err
      if (attempt === attempts - 1) break
      await sleep(baseDelayMs * Math.pow(2, attempt))
    }
  }
  throw lastError
}
