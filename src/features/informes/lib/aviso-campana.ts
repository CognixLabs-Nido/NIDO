import type { CampanaPendientesAviso } from '../types'

/** Umbral de urgencia (Q9): a 3 días naturales o menos de la fecha límite. */
export const UMBRAL_URGENCIA_DIAS = 3

/** Pendientes de una campaña abierta (entrada de la consolidación). */
export interface CampanaPendienteEntry {
  /** Fecha límite de la campaña (AAAA-MM-DD). */
  fechaLimite: string
  /** Informes pendientes de esa campaña para la profe. */
  pendientes: number
}

function ymdToUTC(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * Días naturales desde `hoyYmd` hasta `fechaLimite` (ambos AAAA-MM-DD, huso ya
 * resuelto por quien llama). Negativo si la fecha ya pasó, 0 si es hoy.
 */
export function diasHastaFecha(fechaLimite: string, hoyYmd: string): number {
  return Math.round((ymdToUTC(fechaLimite) - ymdToUTC(hoyYmd)) / 86_400_000)
}

/**
 * Consolida los pendientes de las campañas abiertas en UN solo aviso (Q1). Suma
 * los informes pendientes; la fecha mostrada y la urgencia se rigen por la fecha
 * límite **más próxima** entre las campañas que tienen pendientes. Devuelve `null`
 * si no hay ningún pendiente (todo publicado o sin campañas con trabajo).
 */
export function consolidarAvisoCampana(
  entries: CampanaPendienteEntry[],
  hoyYmd: string
): CampanaPendientesAviso | null {
  const conPendientes = entries.filter((e) => e.pendientes > 0)
  if (conPendientes.length === 0) return null

  const n = conPendientes.reduce((suma, e) => suma + e.pendientes, 0)
  // YYYY-MM-DD ordena cronológicamente como cadena: la mínima es la más próxima.
  const fechaLimite = conPendientes.map((e) => e.fechaLimite).sort()[0]
  const dias = diasHastaFecha(fechaLimite, hoyYmd)

  return {
    n,
    fechaLimite,
    vencida: dias < 0,
    urgente: dias <= UMBRAL_URGENCIA_DIAS,
  }
}
