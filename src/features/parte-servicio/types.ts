import type { ServicioDiario } from './schemas/parte-servicio'

// Patrón Result compartido (duplicado intencionalmente per feature).
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** Niño del aula con su estado de servicio para los 3 servicios de una fecha. */
export interface NinoParteResumen {
  nino: {
    id: string
    nombre: string
    apellidos: string
    foto_url: string | null
  }
  /**
   * Estado por servicio. `true`/`false` si hay registro previo (presente o
   * marcado como no), `null` si nadie lo ha apuntado todavía (lazy).
   */
  servicios: Record<ServicioDiario, boolean | null>
}
