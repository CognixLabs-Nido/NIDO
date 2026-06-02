import type { VistaAgenda } from '../types'

/**
 * Rango horario de la jornada que pintan las vistas día/semana (no 24h: es una
 * guardería). Filas de HORA_INICIO..HORA_FIN inclusive.
 */
export const HORA_INICIO_JORNADA = 7
export const HORA_FIN_JORNADA = 20

/** Horas (enteros) a renderizar en la rejilla. */
export function horasJornada(): number[] {
  const out: number[] = []
  for (let h = HORA_INICIO_JORNADA; h <= HORA_FIN_JORNADA; h++) out.push(h)
  return out
}

/** 'HH:MM' → hora entera clampada al rango de jornada (para ubicar en la rejilla). */
export function horaDeCita(horaInicio: string): number {
  const h = Number(horaInicio.slice(0, 2))
  if (Number.isNaN(h)) return HORA_INICIO_JORNADA
  return Math.min(HORA_FIN_JORNADA, Math.max(HORA_INICIO_JORNADA, h))
}

/** Date → 'YYYY-MM-DD' en componentes locales (huso del navegador = Madrid). */
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' → Date local (medianoche), evitando el parse UTC de `new Date(str)`. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDias(s: string, n: number): string {
  const d = parseYmd(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export function addMeses(s: string, n: number): string {
  const d = parseYmd(s)
  d.setMonth(d.getMonth() + n)
  return ymd(d)
}

/** Lunes de la semana que contiene `s` (ISO: la semana empieza en lunes). */
export function lunesDeSemana(s: string): string {
  const d = parseYmd(s)
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  d.setDate(d.getDate() - dow)
  return ymd(d)
}

/** Los 7 días (lunes→domingo) de la semana que contiene `s`. */
export function diasDeSemana(s: string): string[] {
  const lunes = lunesDeSemana(s)
  return Array.from({ length: 7 }, (_, i) => addDias(lunes, i))
}

/** Rango [desde, hasta] que abarca la vista anclada en `fecha`. */
export function rangoDeVista(vista: VistaAgenda, fecha: string): { desde: string; hasta: string } {
  if (vista === 'dia') return { desde: fecha, hasta: fecha }
  if (vista === 'semana') {
    const dias = diasDeSemana(fecha)
    return { desde: dias[0], hasta: dias[6] }
  }
  // mes: del día 1 al último del mes de `fecha`.
  const d = parseYmd(fecha)
  const desde = ymd(new Date(d.getFullYear(), d.getMonth(), 1))
  const hasta = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  return { desde, hasta }
}

/** Avanza/retrocede el ancla según la vista (día/semana/mes). */
export function navegar(vista: VistaAgenda, fecha: string, dir: -1 | 1): string {
  if (vista === 'dia') return addDias(fecha, dir)
  if (vista === 'semana') return addDias(fecha, dir * 7)
  return addMeses(fecha, dir)
}
