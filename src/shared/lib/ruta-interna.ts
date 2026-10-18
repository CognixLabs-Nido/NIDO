/**
 * Valida un destino que llega de fuera (`?returnTo=`): solo vale una ruta INTERNA de la app en el
 * mismo idioma (`/{locale}/...`). Cualquier otra cosa (URL absoluta, `//host`, barras invertidas,
 * caracteres de control, otro idioma) devuelve `null` y quien llama usa su destino por defecto.
 * Así un enlace con `returnTo` no sirve para sacar a nadie de NIDO (redirección abierta).
 */
export function rutaInterna(locale: string, ruta: string | null | undefined): string | null {
  if (!ruta) return null
  if (!ruta.startsWith(`/${locale}/`)) return null
  if (ruta.startsWith('//') || ruta.includes('\\') || /[\u0000-\u001f]/.test(ruta)) return null
  return ruta
}
