// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esRutaDePlataforma, requiredRolesFor } from '../proxy-roles'

/**
 * `/plataforma` (Fase 5): el panel del superusuario. No va por roles (el superusuario no tiene fila
 * en ningún centro): el proxy pregunta `is_superadmin`, y cualquier otra cosa va a `/forbidden`,
 * también un fallo de la consulta. Mismo arnés que `proxy-sesion.test.ts`.
 */

const estado = vi.hoisted(() => ({
  user: null as { id: string } | null,
  roles: [] as { rol: string }[],
  superusuario: false as boolean | 'error',
  rpcs: [] as string[],
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: estado.user }, error: null }) },
    rpc: async (nombre: string) => {
      estado.rpcs.push(nombre)
      if (nombre !== 'is_superadmin') return { data: null, error: { code: 'PGRST202' } }
      return estado.superusuario === 'error'
        ? { data: null, error: { code: '57014' } }
        : { data: estado.superusuario, error: null }
    },
    from: () => ({
      select: () => ({
        eq: () => ({ is: async () => ({ data: estado.roles, error: null }) }),
      }),
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

describe('proxy — /plataforma solo para el superusuario', () => {
  beforeEach(() => {
    estado.user = { id: 'u-1' }
    estado.roles = []
    estado.superusuario = false
    estado.rpcs = []
  })

  it('el prefijo: /plataforma y sus subrutas, no otra ruta que empiece igual; fuera del mapa de roles', () => {
    expect(esRutaDePlataforma('/plataforma')).toBe(true)
    expect(esRutaDePlataforma('/plataforma/centros/x')).toBe(true)
    expect(esRutaDePlataforma('/plataformas')).toBe(false)
    expect(esRutaDePlataforma('/admin')).toBe(false)
    expect(requiredRolesFor('/plataforma')).toBeNull()
  })

  it('premisa: el arnés deja pasar a Dirección por /admin (los roles se leen)', async () => {
    estado.roles = [{ rol: 'admin' }]
    const res = await proxy(peticion('/es/admin'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('el superusuario entra, y se le pregunta a is_superadmin', async () => {
    estado.superusuario = true
    const res = await proxy(peticion('/es/plataforma'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(estado.rpcs).toEqual(['is_superadmin'])
  })

  it('la admin de un centro (rol admin, no superusuario) va a /forbidden', async () => {
    estado.roles = [{ rol: 'admin' }]
    const res = await proxy(peticion('/va/plataforma'))
    expect(res.headers.get('location')).toContain('/va/forbidden')
  })

  it('si is_superadmin falla, cuenta como «no»', async () => {
    estado.superusuario = 'error'
    const res = await proxy(peticion('/es/plataforma'))
    expect(res.headers.get('location')).toContain('/es/forbidden')
  })

  it('sin sesión, a /login', async () => {
    estado.user = null
    const res = await proxy(peticion('/es/plataforma'))
    expect(res.headers.get('location')).toContain('/es/login')
    expect(estado.rpcs).toEqual([])
  })
})
