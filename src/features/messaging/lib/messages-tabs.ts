/**
 * Literales canónicos del query param `?tab=` de `/messages`. Fuente única que
 * leen TANTO los constructores de URL (router.push/Link de los split-views) como
 * el selector de tab en `MessagesView`, para que no puedan divergir en un rename
 * (origen del bug en que el click admin caía a Anuncios: el builder usaba el
 * literal viejo 'direccion' mientras el selector ya esperaba 'mensajeria').
 *
 * Admin: anuncios (default) | mensajeria (escribe a tutor) | supervision (read-only).
 * Profe/tutor: conversaciones (default) | anuncios.
 */
export const MESSAGES_TAB = {
  anuncios: 'anuncios',
  conversaciones: 'conversaciones',
  mensajeria: 'mensajeria',
  supervision: 'supervision',
} as const

export type MessagesTab = (typeof MESSAGES_TAB)[keyof typeof MESSAGES_TAB]
