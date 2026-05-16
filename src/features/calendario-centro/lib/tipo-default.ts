import type { Database } from '@/types/database'

export type TipoDiaCentro = Database['public']['Enums']['tipo_dia_centro']

const ABIERTOS: ReadonlySet<TipoDiaCentro> = new Set<TipoDiaCentro>([
  'lectivo',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
])

/**
 * Default semántico de tipo de día, equivalente a la rama del helper SQL
 * `tipo_de_dia` cuando NO hay override en `dias_centro`:
 *  - ISODOW 1-5 (lun-vie) → 'lectivo'.
 *  - ISODOW 6-7 (sáb-dom) → 'cerrado'.
 *
 * Se usa en el cliente para calcular el tipo de los días sin override y
 * para los días overflow del grid (mes anterior/siguiente), evitando
 * round-trips innecesarios al servidor.
 *
 * Trabaja sobre `Date` interpretando los campos `getDay()` en local time —
 * es responsabilidad del que construye la fecha (la lib del calendario)
 * usar new Date(anio, mes-1, dia) o equivalente.
 */
export function tipoDefaultDeFecha(fecha: Date): TipoDiaCentro {
  // getDay: domingo=0 ... sábado=6. ISODOW: lunes=1 ... domingo=7.
  const jsDow = fecha.getDay()
  const isoDow = jsDow === 0 ? 7 : jsDow
  return isoDow <= 5 ? 'lectivo' : 'cerrado'
}

/** ¿El centro está abierto ese día según el tipo resuelto? */
export function tipoAbreElCentro(tipo: TipoDiaCentro): boolean {
  return ABIERTOS.has(tipo)
}
