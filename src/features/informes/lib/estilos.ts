/**
 * Tratamiento visual compartido de las listas de informes (F9-5-3). El ámbar señala
 * **solo lo que hay que hacer AHORA**: un pendiente (borrador o sin empezar) de un
 * período con **campaña abierta** (mismo conjunto que el aviso de INICIO de F9-5-2).
 * Verde = publicado; gris/neutro = todo lo demás (períodos sin campaña abierta), para
 * que el ámbar no inunde la lista. **Reutilizar en cualquier lista de informes**
 * (profe, familia F9-3, etc.) para mantener la señal consistente.
 */
import type { EstadoInforme } from '../types'

const PUBLICADO = 'border-success-200 bg-success-50 hover:bg-success-100'
const PENDIENTE_CAMPANA = 'border-amber-200 bg-amber-50 hover:bg-amber-100'
const NEUTRO = 'bg-muted/40 hover:bg-muted'

/**
 * Clases de fondo de un chip de informe. `'publicado'` → verde (siempre). Si no está
 * publicado: ámbar **solo** cuando `pendienteCampana` (su período tiene campaña
 * abierta); en otro caso, gris/neutro. En la vista de familia (F9-3) solo llegan
 * publicados, así que allí siempre es verde (el 2.º argumento no aplica).
 */
export function fondoInforme(estado: EstadoInforme | null, pendienteCampana = false): string {
  if (estado === 'publicado') return PUBLICADO
  return pendienteCampana ? PENDIENTE_CAMPANA : NEUTRO
}
