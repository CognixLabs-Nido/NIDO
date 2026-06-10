/**
 * Tratamiento visual compartido de las listas de informes. Verde = **publicado**
 * (ya está); ámbar = **pendiente** (borrador o sin empezar) para ver de un vistazo
 * qué falta por trabajar (F9-5-3). **Reutilizar en cualquier lista de informes**
 * (profe, familia F9-3, etc.) para mantener la señal consistente.
 */
import type { EstadoInforme } from '../types'

const PUBLICADO = 'border-success-200 bg-success-50 hover:bg-success-100'
const PENDIENTE = 'border-amber-200 bg-amber-50 hover:bg-amber-100'

/**
 * Clases de fondo de un item/chip de informe según su estado. `'publicado'` → verde;
 * `'borrador'` o `null` (sin empezar) → ámbar (pendiente de completar). En la vista
 * de familia (F9-3) solo llegan publicados, así que allí siempre es verde.
 */
export function fondoInforme(estado: EstadoInforme | null): string {
  return estado === 'publicado' ? PUBLICADO : PENDIENTE
}
