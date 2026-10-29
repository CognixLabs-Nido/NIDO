import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

export interface FechasCurso {
  inicio: string
  fin: string
}

/**
 * Las fechas del curso de los fixtures (`createTestCurso`, `matricular`, `asignarProfeAula` y los
 * tests que las necesitan): el curso que contiene el día `hoy` en Madrid, del 1 de septiembre al 31
 * de agosto, así que lo contiene también en agosto. `anios` lo mueve: -1 es el curso anterior, 1
 * el siguiente.
 *
 * Salen de un cálculo y no de un literal: hasta el PR-C eran `2026-09-01`–`2027-07-31`, copiados
 * a mano en los tests que los necesitaban. Medido el 2026-10-29 con el curso ya terminado: la
 * suite RLS seguía en verde salvo `cerrar-curso`, y ese rojo lo daba la copia (una fecha de alta
 * fija posterior al final del curso), no el paso del tiempo. Un literal se queda atrás; el
 * cálculo, no.
 */
export function cursoDeTest(hoy: string = hoyMadrid(), anios = 0): FechasCurso {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number]
  const desde = (mes >= 9 ? anio : anio - 1) + anios
  return { inicio: `${desde}-09-01`, fin: `${desde + 1}-08-31` }
}
