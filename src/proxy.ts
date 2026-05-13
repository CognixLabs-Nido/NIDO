import { createServerClient } from '@supabase/ssr'
import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'

import { routing } from './i18n/routing'

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

// Mapa de prefijos protegidos → rol requerido.
// Notar: el usuario debe tener AL MENOS UN rol coincidente (ver ADR/spec B6.bis).
const PROTECTED_PREFIXES: Array<{ prefix: RegExp; roles: ReadonlyArray<string> }> = [
  { prefix: /^\/admin(\/.*)?$/, roles: ['admin'] },
  { prefix: /^\/teacher(\/.*)?$/, roles: ['profe'] },
  { prefix: /^\/family(\/.*)?$/, roles: ['tutor_legal', 'autorizado'] },
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

function requiredRolesFor(rest: string): ReadonlyArray<string> | null {
  for (const { prefix, roles } of PROTECTED_PREFIXES) {
    if (prefix.test(rest)) return roles
  }
  return null
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const intlResponse = intlMiddleware(request)
  const { pathname } = request.nextUrl

  // El intl middleware puede haber rewriten — usamos siempre la pathname original
  // ya prefijada por locale.
  const { locale, rest } = stripLocale(pathname)

  if (isPublic(rest)) {
    return intlResponse
  }

  const required = requiredRolesFor(rest)

  // Construye un cliente Supabase que lea cookies del request y propague a la response.
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

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = `/${locale}/login`
    url.searchParams.set('returnTo', pathname)
    return NextResponse.redirect(url)
  }

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
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
