import 'server-only'

/**
 * URL base de la app para construir enlaces absolutos en los emails de Auth
 * (invitación, reset de contraseña). Lee `NEXT_PUBLIC_APP_URL`.
 *
 * En **producción** la variable es OBLIGATORIA: si falta, lanza un error claro
 * server-side en vez de caer silenciosamente a `http://localhost:3000`. Un enlace a
 * localhost en un email de producción es un fallo invisible —el email se envía, pero el
 * destinatario aterriza en una URL muerta— que el fallback silencioso anterior ocultaba.
 * Mejor romper ruidosamente en el deploy/primer envío que enviar enlaces inservibles.
 *
 * En **desarrollo** (`NODE_ENV !== 'production'`) mantiene el fallback a
 * `http://localhost:3000` para no exigir la variable en local.
 */
export function getAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) return appUrl
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_APP_URL no está definida en producción: los enlaces de los emails de Auth ' +
        '(invitación, reset de contraseña) apuntarían a http://localhost:3000. ' +
        'Configúrala en el entorno de producción de Vercel.'
    )
  }
  return 'http://localhost:3000'
}
