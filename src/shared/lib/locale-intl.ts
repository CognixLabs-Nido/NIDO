/**
 * Locale de la app (`es` | `en` | `va`) → etiqueta BCP 47 que entiende `Intl` para
 * formatear fechas, horas y dinero. Úsala SIEMPRE que pases el locale de la app a
 * `Intl.DateTimeFormat`, `Intl.NumberFormat` o `toLocale*String`.
 *
 * Por qué: `va` no es un idioma que conozca `Intl` (el valenciano es `ca`, con la variante
 * `ca-ES-valencia`). Con `'va'` cae al locale por defecto del runtime —en el servidor,
 * `en-US`— y la familia que usa la app en valenciano veía «October 9, 2026» y «€1,234.50».
 *
 * Resultado (Node/ICU y navegadores actuales):
 *   - va → `ca-ES`: «9 d’octubre del 2026», «1.234,50 €». Mismas formas que `ca-ES-valencia`
 *     (fechas, meses y dinero idénticos); se usa `ca-ES` por ser la que ya usaban las pantallas
 *     que funcionaban. Ojo: el apóstrofo que pone `Intl` es el tipográfico (’, U+2019).
 *   - es → `es-ES`: «9 de octubre de 2026», «1234,50 €» (CLDR no agrupa miles con 4 cifras).
 *   - en → `en-GB`: «9 October 2026», «€1,234.50».
 *
 * Una etiqueta que ya es BCP 47 completa (`es-ES`, `en-CA`…) pasa tal cual: así los helpers
 * que reciben un locale por defecto `es-ES` siguen funcionando.
 */
const INTL_POR_LOCALE: Record<string, string> = {
  es: 'es-ES',
  en: 'en-GB',
  va: 'ca-ES',
}

export function localeIntl(locale: string): string {
  return INTL_POR_LOCALE[locale] ?? locale
}
