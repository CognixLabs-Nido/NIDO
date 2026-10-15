/**
 * Textos de la página de error global (`src/app/global-error.tsx`). Esa página sustituye
 * al layout raíz, así que no tiene el proveedor de next-intl, e importar los tres
 * `messages/*.json` los metería en el bundle de todas las páginas. Son dos textos, copia
 * de `common.error` y `common.retry`: `textos.test.ts` exige que coincidan con
 * `messages/` en los tres idiomas.
 */
export const TEXTOS_ERROR_GLOBAL = {
  es: { titulo: 'Ha ocurrido un error', reintentar: 'Reintentar' },
  en: { titulo: 'An error occurred', reintentar: 'Retry' },
  va: { titulo: "S'ha produït un error", reintentar: 'Tornar a intentar' },
} as const

export type LocaleErrorGlobal = keyof typeof TEXTOS_ERROR_GLOBAL

/** El idioma del primer segmento de la ruta (`/va/family` → `va`); castellano si no hay. */
export function localeDeRuta(ruta: string | null): LocaleErrorGlobal {
  const segmento = ruta?.split('/')[1]
  return segmento === 'en' || segmento === 'va' ? segmento : 'es'
}
