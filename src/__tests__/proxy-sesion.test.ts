// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * updateSession en el proxy: cuando getUser() renueva el token, la cookie nueva tiene que llegar
 * a DOS sitios (patrón oficial de @supabase/ssr):
 *  - al navegador, como Set-Cookie de la respuesta;
 *  - a los Server Components de ESTA petición, que leen las cabeceras de petición que el
 *    middleware reenvía (`x-middleware-request-cookie`, el protocolo de
 *    `NextResponse.next({ request: { headers } })`, que next-intl usa al crear su respuesta).
 * Con next-intl ANTES de getUser(), la segunda copia llevaba la cookie vieja.
 */

const COOKIE = 'sb-nido-auth-token'

const estado = vi.hoisted(() => ({
  user: null as { id: string } | null,
  roles: [] as { rol: string }[],
  renovar: true,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: {
        setAll: (c: { name: string; value: string; options: Record<string, unknown> }[]) => void
      }
    }
  ) => ({
    auth: {
      getUser: async () => {
        // Como GoTrue al refrescar: la renovación sale por setAll antes de devolver el usuario.
        if (estado.renovar) {
          opts.cookies.setAll([
            { name: COOKIE, value: 'nuevo', options: { path: '/', httpOnly: true } },
          ])
        }
        return { data: { user: estado.user }, error: null }
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ is: async () => ({ data: estado.roles, error: null }) }),
      }),
    }),
  }),
}))

// next-intl no carga en el entorno node de Vitest (importa 'next/server' sin extensión). Se
// sustituye por lo que hace su `next()` (dist/.../middleware/middleware.js): copiar
// `request.headers` EN EL MOMENTO de crear la respuesta y pasarlas como cabeceras de petición.
// Esa copia es la que hace importar el orden respecto a getUser().
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return {
    default: () => (request: NextRequest) => {
      const headers = new Headers(request.headers)
      headers.set('X-NEXT-INTL-LOCALE', 'es')
      return NextResponse.next({ request: { headers } })
    },
  }
})

const { default: proxy } = await import('../proxy')

function peticion(ruta: string) {
  return new NextRequest(`http://localhost:3000${ruta}`, {
    headers: { cookie: `${COOKIE}=viejo; NEXT_LOCALE=es` },
  })
}

/** La cookie que verán los Server Components de esta misma petición. */
function cookieDeLosServerComponents(res: Response): string | null {
  return res.headers.get('x-middleware-request-cookie')
}

describe('proxy — updateSession propaga la cookie renovada', () => {
  beforeEach(() => {
    estado.user = { id: 'u-1' }
    estado.roles = [{ rol: 'admin' }]
    estado.renovar = true
  })

  it('premisa: la petición llega con la cookie vieja', () => {
    expect(peticion('/es/admin').cookies.get(COOKIE)?.value).toBe('viejo')
  })

  it('ruta protegida: el navegador recibe la nueva y los Server Components también', async () => {
    const res = await proxy(peticion('/es/admin'))
    expect(res.status).toBe(200)
    expect(res.cookies.get(COOKIE)?.value).toBe('nuevo')
    expect(cookieDeLosServerComponents(res)).toContain(`${COOKIE}=nuevo`)
    expect(cookieDeLosServerComponents(res)).not.toContain(`${COOKIE}=viejo`)
    // La de next-intl sigue ahí: solo se sustituye la de sesión.
    expect(cookieDeLosServerComponents(res)).toContain('NEXT_LOCALE=es')
  })

  it('ruta pública: igual, aunque no se gatee', async () => {
    const res = await proxy(peticion('/es/login'))
    expect(res.cookies.get(COOKIE)?.value).toBe('nuevo')
    expect(cookieDeLosServerComponents(res)).toContain(`${COOKIE}=nuevo`)
  })

  it('redirección a /forbidden: conserva la cookie nueva para el navegador', async () => {
    estado.roles = [{ rol: 'tutor_legal' }]
    const res = await proxy(peticion('/es/admin'))
    expect(res.headers.get('location')).toContain('/es/forbidden')
    expect(res.cookies.get(COOKIE)?.value).toBe('nuevo')
  })

  it('redirección a /login sin usuario: conserva la cookie que escribió Supabase', async () => {
    estado.user = null
    const res = await proxy(peticion('/es/admin'))
    expect(res.headers.get('location')).toContain('/es/login')
    expect(res.cookies.get(COOKIE)?.value).toBe('nuevo')
  })

  it('sin renovación: los Server Components ven la cookie de la petición, sin tocar', async () => {
    estado.renovar = false
    const res = await proxy(peticion('/es/admin'))
    expect(res.cookies.get(COOKIE)).toBeUndefined()
    expect(cookieDeLosServerComponents(res)).toContain(`${COOKIE}=viejo`)
  })
})
