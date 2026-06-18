import 'server-only'

/**
 * URL base de la app para construir enlaces absolutos en los emails de Auth
 * (invitación, reset de contraseña). Resuelve por capas:
 *
 * 1. **`NEXT_PUBLIC_APP_URL`** explícita (se setea por entorno en Vercel). Gana siempre.
 * 2. **Preview** (`VERCEL_ENV==='preview'`): cae a `https://${VERCEL_URL}` —la URL única de
 *    ese deploy— para NO romper los previews cuando la variable no esté seteada.
 * 3. **Producción** (`VERCEL_ENV==='production'`): la variable es OBLIGATORIA. Si falta,
 *    lanza un error claro server-side en vez de caer silenciosamente a `localhost`. Un
 *    enlace a localhost en un email de producción es un fallo invisible —el email se envía,
 *    pero el destinatario aterriza en una URL muerta—. Mejor romper ruidosamente.
 * 4. **Desarrollo local** (sin `VERCEL_ENV`): fallback a `http://localhost:3000`.
 *
 * El discriminante es **`VERCEL_ENV`**, no `NODE_ENV`: en Vercel `NODE_ENV` vale
 * `'production'` tanto en preview como en producción, así que usarlo rompería los previews.
 * `VERCEL_ENV`/`VERCEL_URL` solo existen server-side; este módulo es `server-only`.
 */
export function getAppUrl(): string {
  // 1. Override explícito (requerido en producción; opcional en preview/dev).
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit

  const vercelEnv = process.env.VERCEL_ENV

  // 2. Preview: cada deploy tiene su propia URL → la usamos, no lanzamos.
  if (vercelEnv === 'preview' && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  // 3. Producción: la variable es obligatoria. Fallo ruidoso, no enlace a localhost.
  if (vercelEnv === 'production') {
    throw new Error(
      'NEXT_PUBLIC_APP_URL no está definida en producción: los enlaces de los emails de Auth ' +
        '(invitación, reset de contraseña) apuntarían a http://localhost:3000. ' +
        'Configúrala en el entorno de producción de Vercel.'
    )
  }

  // 4. Desarrollo local.
  return 'http://localhost:3000'
}
