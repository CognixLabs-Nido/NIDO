import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase 1 — el contexto con un usuario que tiene roles en DOS centros (admin en A,
 * tutora en B). Hoy no existe ninguno en producción: estos tests son la prueba de que funciona.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const AJENO = '99999999-9999-4999-8999-999999999999'

const estado = vi.hoisted(() => ({
  usuario: 'u-1' as string | null,
  filas: [] as Array<{ centro_id: string; rol: string }>,
  cookie: undefined as string | undefined,
  consultasRoles: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: estado.usuario ? { id: estado.usuario } : null } }),
    },
    from: (tabla: string) => {
      if (tabla !== 'roles_usuario') throw new Error(`tabla inesperada ${tabla}`)
      estado.consultasRoles++
      const q = {
        select: () => q,
        eq: () => q,
        is: async () => ({ data: estado.filas, error: null }),
      }
      return q
    },
  }),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) =>
      nombre === 'nido_centro_activo' && estado.cookie !== undefined
        ? { value: estado.cookie }
        : undefined,
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

const { getEstadoCentro, requireContextoCentro, contextoEnCentro } =
  await import('../get-contexto-centro')

const DOS_CENTROS = [
  { centro_id: A, rol: 'admin' },
  { centro_id: B, rol: 'tutor_legal' },
]

beforeEach(() => {
  estado.usuario = 'u-1'
  estado.filas = DOS_CENTROS
  estado.cookie = undefined
  estado.consultasRoles = 0
})

describe('usuario con roles en dos centros', () => {
  it('premisa: el mock entrega los dos centros', async () => {
    const r = await getEstadoCentro()
    expect(r.tipo).toBe('elegir')
    if (r.tipo === 'elegir') expect(r.centros.map((c) => c.centroId)).toEqual([A, B])
  })

  it('cookie A → centro A como admin', async () => {
    estado.cookie = A
    const ctx = await requireContextoCentro('es')
    expect(ctx).toMatchObject({ centroId: A, rol: 'admin', esSuperusuario: false })
    expect(ctx.centros).toHaveLength(2)
  })

  it('cookie B → centro B como tutora', async () => {
    estado.cookie = B
    expect(await requireContextoCentro('es')).toMatchObject({ centroId: B, rol: 'tutor_legal' })
  })

  it.each([
    ['sin cookie', undefined],
    ['cookie de un centro ajeno', AJENO],
  ])('%s → al selector, con returnTo', async (_caso, cookie) => {
    estado.cookie = cookie
    await expect(requireContextoCentro('es', '/es/admin/recibos')).rejects.toThrow(
      'REDIRECT:/es/elegir-centro?returnTo=%2Fes%2Fadmin%2Frecibos'
    )
  })

  it('contextoEnCentro usa el centro EXPLÍCITO e ignora la cookie', async () => {
    estado.cookie = A
    expect(await contextoEnCentro(B)).toMatchObject({ centroId: B, rol: 'tutor_legal' })
    expect(await contextoEnCentro(AJENO)).toBeNull()
  })
})

describe('usuario con un solo centro', () => {
  it('entra directo aunque la cookie sea de otro centro', async () => {
    estado.filas = [{ centro_id: A, rol: 'profe' }]
    estado.cookie = B
    expect(await requireContextoCentro('es')).toMatchObject({ centroId: A, rol: 'profe' })
  })
})

describe('sin sesión o sin roles', () => {
  it('sin sesión → login', async () => {
    estado.usuario = null
    await expect(requireContextoCentro('es')).rejects.toThrow('REDIRECT:/es/login')
    expect(estado.consultasRoles).toBe(0)
  })

  it('sin roles activos → forbidden', async () => {
    estado.filas = []
    await expect(requireContextoCentro('va')).rejects.toThrow('REDIRECT:/va/forbidden')
  })
})
