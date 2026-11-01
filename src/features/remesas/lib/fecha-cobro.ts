import { localeIntl } from '@/shared/lib/locale-intl'

/** «5 nov 2026» (o lo de cada idioma) de una fecha YYYY-MM-DD, sin que el huso la mueva. */
export function formatFechaCobro(fecha: string, locale: string): string {
  return new Intl.DateTimeFormat(localeIntl(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${fecha}T12:00:00Z`))
}

/** Por qué no se puede cambiar la fecha de una remesa, o null si se puede. */
export function bloqueoFechaRemesa(remesa: {
  estado: string
  ficheroGenerado: boolean
}): 'bloqueada_enviada' | 'bloqueada_fichero' | null {
  if (remesa.estado !== 'borrador') return 'bloqueada_enviada'
  if (remesa.ficheroGenerado) return 'bloqueada_fichero'
  return null
}

/**
 * Las fechas de unos recibos, agrupadas: primero los sin fecha («en cuanto el banco pueda») y
 * después cada fecha, de la más temprana a la más tardía, con cuántos recibos la llevan.
 */
export function resumenFechas(
  recibos: ReadonlyArray<{ fechaCobro: string | null }>
): Array<{ fecha: string | null; num: number }> {
  const cuenta = new Map<string | null, number>()
  for (const r of recibos) cuenta.set(r.fechaCobro, (cuenta.get(r.fechaCobro) ?? 0) + 1)
  return [...cuenta.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([fecha, num]) => ({ fecha, num }))
}
