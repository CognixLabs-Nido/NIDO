import type { AlertaCentro, MetricasCentro } from '../types'

/**
 * Las alertas de un centro, en el orden en que se pintan. La invitación de admin solo llega con el
 * centro sin admin (la función no la devuelve si hay una viva), y va junto a `sin_admin`: dice si la
 * salida está en camino o se quedó caducada.
 */
export function alertasDe(c: MetricasCentro): AlertaCentro[] {
  const alertas: AlertaCentro[] = []
  if (c.sinAdmin) alertas.push('sin_admin')
  if (c.invitacionAdmin === 'pendiente') alertas.push('invitacion_admin_pendiente')
  if (c.invitacionAdmin === 'caducada') alertas.push('invitacion_admin_caducada')
  if (c.sinCursoActivo) alertas.push('sin_curso_activo')
  return alertas
}
