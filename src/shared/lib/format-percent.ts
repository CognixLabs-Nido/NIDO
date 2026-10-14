import { localeIntl } from '@/shared/lib/locale-intl'

// Porcentajes en la UI. En NIDO un porcentaje se guarda en PUNTOS BÁSICOS (enteros):
// 1250 = 12,5 % (`conceptos_cobro.porcentaje_bp`).

/**
 * Formatea puntos básicos como porcentaje localizado: «12,5 %» en `es`/`va`, «12.5%» en `en`.
 * El `locale` es obligatorio, como en `formatEuros`: montar el texto a mano
 * (`${bp / 100}%`) sacaba «12.5%» también en castellano y en valenciano. Acepta el locale
 * de la app (`es`/`en`/`va`) o una etiqueta BCP 47; `localeIntl` hace el mapeo.
 */
export function formatPorcentaje(puntosBasicos: number, locale: string): string {
  return new Intl.NumberFormat(localeIntl(locale), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(puntosBasicos / 10000)
}
