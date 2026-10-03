import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R5 — las server actions de invitación de profe autorizan ANTES de leer nada con service
 * client. Sin sesión, o con sesión pero sin rol admin, se rechaza sin crear el service client
 * (y por tanto sin consultar aulas / profes_aulas / invitaciones): anon no distingue "el aula
 * existe / ya tiene coordinadora / no autorizado".
 */

const getUser = vi.fn()
const rolesAdmin = vi.fn()
const createServiceRoleClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => {
      // roles_usuario: .select().eq().eq().is() → { data }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => rolesAdmin()
      return b
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../send-invitation', () => ({ sendInvitation: vi.fn() }))

const { invitarProfe, reenviarInvitacionProfe, revocarInvitacionProfe } =
  await import('../invitar-profe')

const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const INV = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const INPUT = {
  nombreCompleto: 'Profe Pruebas',
  email: 'profe@example.com',
  aulaId: AULA,
  tipoPersonalAula: 'coordinadora' as const,
}

const acciones = [
  ['invitarProfe', () => invitarProfe(INPUT, 'es')],
  ['reenviarInvitacionProfe', () => reenviarInvitacionProfe(INV, 'es')],
  ['revocarInvitacionProfe', () => revocarInvitacionProfe(INV)],
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('R5 — invitación de profe: autorizar antes de leer', () => {
  it.each(acciones)('%s sin sesión → unauthenticated, sin service client', async (_n, run) => {
    getUser.mockResolvedValue({ data: { user: null } })
    const r = await run()
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.unauthenticated' })
    expect(rolesAdmin).not.toHaveBeenCalled()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it.each(acciones)(
    '%s con sesión pero sin rol admin → forbidden, sin service client',
    async (_n, run) => {
      getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
      rolesAdmin.mockResolvedValue({ data: [] })
      const r = await run()
      expect(r).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
      expect(createServiceRoleClient).not.toHaveBeenCalled()
    }
  )

  it('admin legítimo: pasa la guarda y llega al service client', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rolesAdmin.mockResolvedValue({ data: [{ centro_id: 'c1' }] })
    // Service client mínimo: el aula no está en sus centros → no_encontrada (ya autorizado).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.in = () => b
    b.is = () => b
    b.maybeSingle = async () => ({ data: null, error: null })
    createServiceRoleClient.mockReturnValue({ from: () => b })
    const r = await invitarProfe(INPUT, 'es')
    expect(createServiceRoleClient).toHaveBeenCalledOnce()
    expect(r).toEqual({ success: false, error: 'aula.errors.no_encontrada' })
  })
})
