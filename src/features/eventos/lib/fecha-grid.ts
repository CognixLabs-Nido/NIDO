import type { EventoCalendario } from '../types'

/** 'YYYY-MM-DD' de un Date local (sin hora). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Indexa los eventos por día ('YYYY-MM-DD'). Un evento con rango (`fecha_fin`)
 * aparece en cada día del rango. Los días se generan iterando fechas (máx. 60
 * días por evento como salvaguarda ante rangos absurdos).
 */
export function indexarEventosPorDia(eventos: EventoCalendario[]): Map<string, EventoCalendario[]> {
  const map = new Map<string, EventoCalendario[]>()
  for (const ev of eventos) {
    const inicio = parseYmd(ev.fecha)
    const fin = ev.fecha_fin ? parseYmd(ev.fecha_fin) : inicio
    let cursor = inicio
    let guard = 0
    while (cursor <= fin && guard < 60) {
      const key = ymd(cursor)
      const arr = map.get(key)
      if (arr) arr.push(ev)
      else map.set(key, [ev])
      cursor = addDays(cursor, 1)
      guard += 1
    }
  }
  return map
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
