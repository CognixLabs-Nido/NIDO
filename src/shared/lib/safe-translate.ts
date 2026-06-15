/**
 * Traducción segura de mensajes de error.
 *
 * Si `message` es una clave i18n conocida, devuelve su traducción (mensaje
 * ESPECÍFICO). Si no lo es —una clave sin traducir o un string crudo de
 * servidor/Supabase— devuelve un mensaje genérico traducido. NUNCA expone el
 * string crudo al usuario.
 *
 * Convención: los mensajes de error (schemas Zod, `fail(...)` de las acciones)
 * son claves i18n absolutas (p. ej. `auth.validation.password.too_short`). El
 * fallback solo se usa para errores no mapeados.
 */

export const FALLBACK_ERROR_KEY = 'common.error'

interface Translator {
  (key: string): string
  has: (key: string) => boolean
}

export function safeTranslateError(t: Translator, message: string | null | undefined): string {
  if (!message) return ''
  return t.has(message) ? t(message) : t(FALLBACK_ERROR_KEY)
}
