// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La exportación de mis datos (art. 15) con los vínculos sin leer (censo C, B1, 2026-11-26): salía sin los
 * hijos y sin decirlo. Ahora contesta 500 y no entrega una exportación incompleta.
 */
const { bd } = vi.hoisted(() => ({
  bd: { errVinc: null as unknown, ninosRecolectados: [] as string[] },
}))

vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/export/lib/empaquetar', () => ({
  empaquetarExport: async () => new Uint8Array([1]),
}))
vi.mock('@/features/export/lib/registrar', () => ({ registrarExport: async () => {} }))
vi.mock('@/features/export/lib/recolectar', () => ({
  recolectarUsuario: async () => ({ data: {}, centroId: 'centro-1' }),
  recolectarNino: async (_s: unknown, _v: unknown, id: string) => {
    bd.ninosRecolectados.push(id)
    return { data: { id }, centroId: 'centro-1' }
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.is = async () =>
        bd.errVinc
          ? { data: null, error: bd.errVinc }
          : { data: [{ nino_id: 'nino-1', tipo_vinculo: 'tutor_legal_principal' }], error: null }
      return c
    },
  }),
}))

const { GET } = await import('../route')
const pedir = () =>
  GET(new Request('http://x/es/export/me'), { params: Promise.resolve({ locale: 'es' }) })

beforeEach(() => {
  bd.errVinc = null
  bd.ninosRecolectados = []
})

describe('GET /export/me', () => {
  it('premisa: con los vínculos leídos, el zip lleva al hijo', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(bd.ninosRecolectados).toEqual(['nino-1'])
  })

  it('sin leer los vínculos: 500, no un zip sin los hijos', async () => {
    bd.errVinc = { code: 'XX000', message: 'caída' }
    const res = await pedir()
    expect(res.status).toBe(500)
    expect(bd.ninosRecolectados).toEqual([])
  })
})
