/**
 * La ficha médica bloqueada (20261204120000): terminado el curso de la baja, nadie la lee ni la
 * escribe (art. 32 LOPDGDD). Las funciones de la ficha contestan 55000 con la fecha en DETAIL.
 * Devuelve esa fecha (AAAA-MM-DD) si el error es el del bloqueo, o NULL si es otro.
 *
 * Se mira el código Y la forma del DETAIL: 55000 lo usan otras funciones, y una fecha que no
 * llega no se inventa.
 */
export function fichaMedicaBloqueadaDesde(
  error: { code?: string; details?: string | null } | null
): string | null {
  if (error?.code !== '55000') return null
  const fecha = error.details ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null
}
