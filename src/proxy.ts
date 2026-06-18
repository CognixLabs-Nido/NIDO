import { createServerClient } from '@supabase/ssr'
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
  const intlResponse = intlMiddleware(request)
  const { pathname } = request.nextUrl

  // El intl middleware puede haber rewriten — usamos siempre la pathname original
  // ya prefijada por locale.
  const { locale, rest } = stripLocale(pathname)

  // updateSession (patrón estándar @supabase/ssr): refresca la sesión y PROPAGA las
  // cookies rotadas a la response en TODAS las rutas, también las públicas. Sin esto, el
  // token que rota dentro de una Server Action / Server Component no se sincroniza a la
  // siguiente request y el destino no ve la sesión (causa del band-aid 4910fbc). El
  // gating de rol (requiredRolesFor) se SUMA debajo; no se sustituye.
  // ⚠️ Gotcha @supabase/ssr: NO meter lógica entre createServerClient y getUser().
  const response = intlResponse
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user

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

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
