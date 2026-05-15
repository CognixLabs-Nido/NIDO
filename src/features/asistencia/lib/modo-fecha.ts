import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

/**
 * Tres modos para una fecha vista en asistencia:
 *  - `hoy`: día corriente, editable (RLS permite INSERT/UPDATE en asistencias).
 *  - `historico`: días anteriores, read-only, muestra estado registrado.
 *  - `futuro`: días posteriores, read-only, preview de ausencias ya reportadas.
 */
export type ModoFecha = 'hoy' | 'historico' | 'futuro'

export function modoDeFecha(fecha: string): ModoFecha {
  const hoy = hoyMadrid()
  if (fecha === hoy) return 'hoy'
  if (fecha < hoy) return 'historico'
  return 'futuro'
}
