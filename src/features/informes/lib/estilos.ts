/**
 * Tratamiento visual compartido de las listas de informes. Los informes
 * **publicados** llevan un fondo verde claro sutil para distinguirlos de un
 * vistazo de los borradores. **Reutilizar en cualquier lista de informes**
 * posterior (familia F9-3, etc.) para mantener la señal consistente.
 */
import type { EstadoInforme } from '../types'

const PUBLICADO = 'border-success-200 bg-success-50 hover:bg-success-100'
const BORRADOR = 'bg-muted/40 hover:bg-muted'

/** Clases de fondo de un item/chip de informe según su estado. */
export function fondoInforme(estado: EstadoInforme | null): string {
  return estado === 'publicado' ? PUBLICADO : BORRADOR
}
