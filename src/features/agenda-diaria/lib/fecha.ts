/**
 * Helpers de fecha para la agenda diaria. Trabajamos con strings `YYYY-MM-DD`
 * en el huso `Europe/Madrid` para casar 1:1 con el helper Postgres
 * `dentro_de_ventana_edicion(fecha)`. Nunca usamos `new Date()` directamente
 * para derivar "hoy" porque puede divergir si el cliente está en otro huso.
 */

const MADRID = 'Europe/Madrid'

function format(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  return [
    parts.find((p) => p.type === 'year')!.value,
    parts.find((p) => p.type === 'month')!.value,
    parts.find((p) => p.type === 'day')!.value,
  ].join('-')
}

export function hoyMadrid(): string {
  return format(new Date())
}

export function offsetDias(fecha: string, dias: number): string {
  // Parseamos a 12:00 UTC para evitar saltos de día en el límite DST.
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + dias)
  return format(dt)
}

export function esHoy(fecha: string): boolean {
  return fecha === hoyMadrid()
}

export function esFuturo(fecha: string): boolean {
  return fecha > hoyMadrid()
}

export function formatearFechaHumano(fecha: string, locale: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return new Intl.DateTimeFormat(locale, {
    timeZone: MADRID,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dt)
}
