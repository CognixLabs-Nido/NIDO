import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

/**
 * Tres modos para una fecha vista en superficies operativas (asistencia,
 * comida batch, futuras superficies de Ola 1):
 *  - `hoy`:       día corriente, editable (RLS permite INSERT/UPDATE).
 *  - `historico`: días anteriores, read-only.
 *  - `futuro`:    días posteriores, read-only / preview.
 *
 * Centralizado aquí para reuso entre F4 (asistencia) y F4.5 (comida).
 */
export type ModoFecha = 'hoy' | 'historico' | 'futuro'

export function modoDeFecha(fecha: string): ModoFecha {
  const hoy = hoyMadrid()
  if (fecha === hoy) return 'hoy'
  if (fecha < hoy) return 'historico'
  return 'futuro'
}
