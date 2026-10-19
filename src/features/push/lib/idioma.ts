import { routing } from '@/i18n/routing'

/** Un idioma de la app (los de `routing`, la misma lista que el proxy y las rutas). */
export type Idioma = (typeof routing.locales)[number]

export const IDIOMA_POR_DEFECTO: Idioma = routing.defaultLocale

export function esIdioma(valor: unknown): valor is Idioma {
  return typeof valor === 'string' && (routing.locales as readonly string[]).includes(valor)
}
