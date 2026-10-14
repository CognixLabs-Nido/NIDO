import { localeIntl } from '@/shared/lib/locale-intl'

// Utilidades de dinero. En NIDO el dinero se guarda SIEMPRE en céntimos (enteros)
// en BD; en la UI se introduce y muestra en euros. Centralizado para no repetir la
// conversión ni el formato (F12-B). Sin dependencias: testeable como función pura.

/** Convierte euros (puede traer decimales) a céntimos enteros, redondeando. */
export function eurosACentimos(euros: number): number {
  return Math.round(euros * 100)
}

/** Convierte céntimos enteros a euros (número, no string). */
export function centimosAEuros(centimos: number): number {
  return centimos / 100
}

/**
 * Formatea céntimos como importe en euros localizado (p. ej. "6,00 €" en `es`, "€6.00" en `en`).
 * El `locale` es obligatorio a propósito: con un valor por defecto, 22 de 32 llamadas lo
 * olvidaban y la familia en `en`/`va` veía el formato de `es`. Acepta el locale de la app
 * (`es`/`en`/`va`) o una etiqueta BCP 47; `localeIntl` hace el mapeo.
 */
export function formatEuros(centimos: number, locale: string): string {
  return new Intl.NumberFormat(localeIntl(locale), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centimosAEuros(centimos))
}
