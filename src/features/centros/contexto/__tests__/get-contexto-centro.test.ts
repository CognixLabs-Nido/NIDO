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
  /** La ruta pedida que el proxy deja en la cabecera (`x-nido-ruta-pedida`). */
  rutaPedida: null as string | null,
  consultasRoles: 0,
  /** Lo que responde `is_superadmin`, y los centros que existen (solo los lee el superusuario). */
  superusuario: false,
  centrosExistentes: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: estado.usuario ? { id: estado.usuario } : null } }),
    },
    rpc: async (fn: string) => {
      if (fn !== 'is_superadmin') throw new Error(`rpc inesperada ${fn}`)
      return { data: estado.superusuario, error: null }
    },
    from: (tabla: string) => {
      if (tabla === 'centros') {
        const c = {
          select: () => c,
          is: async () => ({ data: estado.centrosExistentes.map((id) => ({ id })), error: null }),
        }
        return c
      }
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
  headers: async () => ({
    get: (nombre: string) => (nombre === 'x-nido-ruta-pedida' ? estado.rutaPedida : null),
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
  estado.rutaPedida = null
  estado.consultasRoles = 0
  estado.superusuario = false
  estado.centrosExistentes = []
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

  it('sin returnTo → al selector, con la ruta que se pidió (la notificación vuelve al aviso)', async () => {
    estado.rutaPedida = '/es/messages?nino=n-1&centro=c-b'
    await expect(requireContextoCentro('es')).rejects.toThrow(
      'REDIRECT:/es/elegir-centro?returnTo=%2Fes%2Fmessages%3Fnino%3Dn-1%26centro%3Dc-b'
    )
  })

  it('el returnTo explícito manda sobre la ruta pedida', async () => {
    estado.rutaPedida = '/es/messages'
    await expect(requireContextoCentro('es', '/es/admin/recibos')).rejects.toThrow(
      'REDIRECT:/es/elegir-centro?returnTo=%2Fes%2Fadmin%2Frecibos'
    )
  })

  it('sin returnTo ni ruta pedida → al selector sin vuelta, como antes', async () => {
    await expect(requireContextoCentro('es')).rejects.toThrow(/^REDIRECT:\/es\/elegir-centro$/)
  })

  it('con el centro elegido, la ruta pedida no cambia nada', async () => {
    estado.cookie = A
    estado.rutaPedida = '/es/messages'
    expect(await requireContextoCentro('es')).toMatchObject({ centroId: A })
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

describe('superusuario (Fase 3): admin de todos los centros, sin roles propios', () => {
  beforeEach(() => {
    estado.filas = []
    estado.superusuario = true
    estado.centrosExistentes = [A]
  })

  it('con UN solo centro y sin cookie, elige: no entra sin pasar por elegirCentro', async () => {
    const r = await getEstadoCentro()
    expect(r).toEqual({
      tipo: 'elegir',
      centros: [{ centroId: A, rol: 'admin', roles: ['admin'] }],
      esSuperusuario: true,
    })
    await expect(requireContextoCentro('es', '/es/admin')).rejects.toThrow(
      'REDIRECT:/es/elegir-centro?returnTo=%2Fes%2Fadmin'
    )
  })

  it('con la cookie de un centro que existe: admin en ese centro, marcado como superusuario', async () => {
    estado.centrosExistentes = [A, B]
    estado.cookie = B
    expect(await requireContextoCentro('es')).toMatchObject({
      centroId: B,
      rol: 'admin',
      esSuperusuario: true,
    })
  })

  it('contextoEnCentro: admin en cualquier centro que existe; en uno inexistente, null', async () => {
    estado.centrosExistentes = [A, B]
    expect(await contextoEnCentro(B)).toMatchObject({
      centroId: B,
      rol: 'admin',
      esSuperusuario: true,
    })
    expect(await contextoEnCentro(AJENO)).toBeNull()
  })

  it('el usuario normal sigue igual: esSuperusuario false', async () => {
    estado.superusuario = false
    estado.filas = [{ centro_id: A, rol: 'profe' }]
    expect(await requireContextoCentro('es')).toMatchObject({ centroId: A, esSuperusuario: false })
  })
})
