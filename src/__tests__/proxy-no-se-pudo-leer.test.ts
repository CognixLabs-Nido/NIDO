// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (decisión de Jose del 2026-11-25): si el proxy no puede leer los roles de quien entra, ni
 * «no tienes acceso» (falso) ni un 500 crudo: la página pública `/no-se-pudo-leer`, por REWRITE (la
 * dirección no cambia; recargar es reintentar), sin dar acceso. Mismo arnés que `proxy-plataforma`.
 */

const estado = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  roles: { data: [] as { rol: string }[] | null, error: null as unknown },
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: estado.user }, error: null }) },
    rpc: async () => ({ data: false, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ is: async () => estado.roles }) }),
    }),
  }),
}))

vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')
  return {
    default: () => (request: NextRequest) =>
      NextResponse.next({ request: { headers: request.headers } }),
  }
})

const { default: proxy } = await import('../proxy')
const peticion = (ruta: string) => new NextRequest(`http://localhost:3000${ruta}`)

describe('proxy — los roles no se pueden leer', () => {
  beforeEach(() => {
    estado.user = { id: 'u-1' }
    estado.roles = { data: [], error: null }
  })

  it('premisa: con los roles leídos y sin rol de Dirección, /admin va a /forbidden', async () => {
    const res = await proxy(peticion('/es/admin'))
    expect(res.headers.get('location')).toContain('/es/forbidden')
  })

  it('con la lectura caída: rewrite a /no-se-pudo-leer, sin redirigir y sin dejar pasar', async () => {
    estado.roles = { data: null, error: { message: 'timeout', code: '57014' } }
    const res = await proxy(peticion('/va/admin/ninos?x=1'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://localhost:3000/va/no-se-pudo-leer')
  })

  it('la página es pública: sin sesión se sirve tal cual (no manda a login)', async () => {
    estado.user = null
    const res = await proxy(peticion('/es/no-se-pudo-leer'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })
})
