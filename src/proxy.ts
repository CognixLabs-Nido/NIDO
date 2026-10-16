import { type CookieOptions, createServerClient } from '@supabase/ssr'
import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'

import { routing } from './i18n/routing'
import { requiredRolesFor } from './proxy-roles'

import type { Database } from '@/types/database'

const intlMiddleware = createIntlMiddleware(routing)

// Rutas públicas (sin autenticación). Se evalúan tras el prefijo de locale.
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/?$/, // /
  /^\/login\/?$/,
  /^\/forgot-password\/?$/,
  /^\/reset-password\/?$/,
  /^\/invitation(\/.*)?$/,
  /^\/privacy\/?$/,
  /^\/terms\/?$/,
  /^\/forbidden\/?$/,
]

function stripLocale(pathname: string): { locale: string; rest: string } {
  const parts = pathname.split('/')
  const locale = parts[1] ?? routing.defaultLocale
  const rest = '/' + parts.slice(2).join('/')
  return { locale, rest: rest === '/' ? '/' : rest.replace(/\/$/, '') }
}

function isPublic(rest: string): boolean {
  return PUBLIC_PATTERNS.some((re) => re.test(rest))
}

/**
 * Redirige PRESERVANDO las cookies que `supabase.auth.getUser()` pudo refrescar en
 * `from` (rotación del token). Sin esto, un `NextResponse.redirect` nuevo descarta
 * esas cookies → el token rotado se pierde → el siguiente request no tiene sesión y
 * acaba en /login: abrir algo sin permiso CERRABA la sesión. (Gotcha clásico de
 * @supabase/ssr: hay que propagar las cookies a TODA respuesta, incl. redirects.)
 */
function redirectConservandoCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie)
  return redirect
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // El intl middleware puede reescribir la ruta: usamos siempre la pathname original,
  // ya prefijada por locale.
  const { locale, rest } = stripLocale(pathname)

  // updateSession (patrón estándar @supabase/ssr): refresca la sesión y PROPAGA las
  // cookies rotadas en TODAS las rutas, también las públicas. Sin esto, el token que rota
  // dentro de una Server Action / Server Component no se sincroniza a la siguiente request
  // y el destino no ve la sesión (causa del band-aid 4910fbc). El gating de rol
  // (requiredRolesFor) se SUMA debajo; no se sustituye.
  // Como el patrón oficial, las cookies renovadas van a DOS sitios: a `request.cookies`, para
  // que los Server Components de ESTA petición vean el token nuevo, y a la respuesta, para el
  // navegador. El oficial rehace `NextResponse.next({ request })`; aquí la respuesta es la de
  // next-intl, que copia `request.headers` al crearse. Por eso next-intl va DESPUÉS de
  // getUser(): si fuera antes, los Server Components verían la cookie vieja.
  // ⚠️ Gotcha @supabase/ssr: NO meter lógica entre createServerClient y getUser().
  const renovadas: { name: string; value: string; options: CookieOptions }[] = []
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            renovadas.push({ name, value, options })
          })
        },
      },
    }
  )

  // getUser() y no getClaims() (el patrón oficial actual), a propósito: getClaims valida el JWT
  // en local y un usuario purgado y baneado seguiría pasando el proxy hasta que caduque su token
  // (≤1 h); getUser pregunta a Auth y se entera al momento. Con purgas RGPD de por medio, eso
  // pesa más que la llamada de red. Ver docs/architecture/auth-proxy.md.
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user

  const response = intlMiddleware(request)
  for (const { name, value, options } of renovadas) response.cookies.set(name, value, options)

  // Rutas públicas: la sesión ya quedó refrescada en `response`; ni se gatea ni se
  // redirige a login (un invitado/anónimo puede verlas).
  if (isPublic(rest)) {
    return response
  }

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.searchParams.set('returnTo', pathname)
    return redirectConservandoCookies(url, response)
  }

  const required = requiredRolesFor(rest)
  if (required) {
    const { data: roles } = await supabase
      .from('roles_usuario')
      .select('rol')
      .eq('usuario_id', user.id)
      .is('deleted_at', null)

    const userRoles = (roles ?? []).map((r) => r.rol)
    const hasAny = required.some((r) =>
      userRoles.includes(r as Database['public']['Enums']['user_role'])
    )
    if (!hasAny) {
      const url = request.nextUrl.clone()
      url.pathname = `/${locale}/forbidden`
      url.search = ''
      return redirectConservandoCookies(url, response)
    }
  }

  return response
}

// Más estrecho que el matcher oficial (que solo quita los estáticos), a propósito:
// - /api: hoy solo hay `cron`, que no lleva sesión de usuario; una ruta de /api con sesión
//   tendría que refrescarla ella misma.
// - rutas con punto: son ficheros de public/. Una página con un «.» en un segmento se saltaría
//   el proxy, así que los segmentos de página no llevan punto.
// - /monitoring: el túnel de Sentry (ADR-0056), una reescritura hacia la UE sin página
//   detrás. Sin excluirlo, next-intl lo redirigiría a /es/monitoring y los eventos no
//   llegarían. Ninguna página puede empezar por «monitoring»: se saltaría el control de rol.
export const config = {
  matcher: ['/((?!api|_next|_vercel|monitoring|.*\\..*).*)'],
}
