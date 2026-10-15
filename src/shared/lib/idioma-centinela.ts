/**
 * La purga RGPD del niño deja `'zz'` en `ninos.idioma_principal` y en
 * `datos_pedagogicos_nino.idiomas_casa`: no es un idioma, es el centinela de «borrado» (un NOT
 * NULL no admite vacío, y poner `'es'` inventaba un dato). Nunca se enseña.
 */
export const IDIOMA_CENTINELA_PURGA = 'zz'

// Endónimos, como en los selectores de idioma de la app: no se traducen.
const ENDONIMOS: Record<string, string> = { es: 'Español', en: 'English', va: 'Valencià' }

/** Etiqueta de `idioma_principal`: el endónimo, o «—» para el centinela o un código raro. */
export function etiquetaIdiomaPrincipal(codigo: string | null | undefined): string {
  return (codigo && ENDONIMOS[codigo]) || '—'
}

/** `idiomas_casa` sin el centinela de la purga. */
export function idiomasVisibles(codigos: readonly string[] | null | undefined): string[] {
  return (codigos ?? []).filter((c) => c !== IDIOMA_CENTINELA_PURGA)
}
