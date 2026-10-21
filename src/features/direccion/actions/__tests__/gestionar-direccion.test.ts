// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR 4 del modelo de roles — las acciones de la pantalla de Dirección. Invitar, dar de baja y
 * traspasar son de la admin; una directora recibe «no autorizado» sin que la app llame a nada.
 * Dejar la dirección es de cada directora; a la admin, la RPC le contesta 55000 y sale el aviso.
 * La BD lo vuelve a comprobar (`direccion-traspaso.rls.test.ts`).
 */

const A = '00000000-0000-4000-8000-00000000000a'
const YO = '11111111-1111-4111-8111-111111111111'
const OTRA = '22222222-2222-4222-8222-222222222222'
const INVITACION = '33333333-3333-4333-8333-333333333333'

const st = vi.hoisted(() => ({
  roles: [] as Array<{ centro_id: string; rol: string }>,
  rpc: vi.fn(),
  borrados: vi.fn(),
  sendInvitation: vi.fn(),
  invitacionBorrada: { id: 'inv' } as unknown,
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in']) b[m] = () => b
  b.delete = () => {
    st.borrados(table)
    return b
  }
  b.maybeSingle = async () => ({ data: st.invitacionBorrada, error: null })
  b.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      table === 'roles_usuario' ? { data: st.roles, error: null } : { data: null, error: null }
    )
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: YO } }, error: null }) },
    from: (t: string) => builder(t),
    rpc: (fn: string, args: unknown) =>
      fn === 'is_superadmin' ? Promise.resolve({ data: false, error: null }) : st.rpc(fn, args),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/actions/send-invitation', () => ({ sendInvitation: st.sendInvitation }))

const {
  cancelarInvitacionDirectora,
  darDeBajaDirectora,
  dejarLaDireccion,
  invitarDirectora,
  traspasarAdmin,
} = await import('../gestionar-direccion')

const ADMIN = [{ centro_id: A, rol: 'admin' }]
const DIRECTORA = [{ centro_id: A, rol: 'directora' }]
const PROFE = [{ centro_id: A, rol: 'profe' }]
const NO_AUTORIZADO = { success: false, error: 'direccion.errors.no_autorizado' }

beforeEach(() => {
  vi.clearAllMocks()
  st.rpc.mockResolvedValue({ data: null, error: null })
  st.sendInvitation.mockResolvedValue({ success: true, data: { invitationId: 'x' } })
  st.invitacionBorrada = { id: INVITACION }
})

describe('invitar a una directora', () => {
  it('la admin invita: sendInvitation con rol directora en su centro', async () => {
    st.roles = ADMIN
    const r = await invitarDirectora({ email: 'nueva@example.com', idioma: 'va' }, A)
    expect(r.success).toBe(true)
    expect(st.sendInvitation).toHaveBeenCalledWith({
      email: 'nueva@example.com',
      rolObjetivo: 'directora',
      centroId: A,
      idioma: 'va',
    })
  })

  it('una directora no: no autorizado, sin llegar a sendInvitation', async () => {
    st.roles = DIRECTORA
    expect(await invitarDirectora({ email: 'nueva@example.com', idioma: 'es' }, A)).toEqual(
      NO_AUTORIZADO
    )
    expect(st.sendInvitation).not.toHaveBeenCalled()
  })

  it('un correo que no lo es: error de validación, sin llamar a nada', async () => {
    st.roles = ADMIN
    const r = await invitarDirectora({ email: 'no-es-correo', idioma: 'es' }, A)
    expect(r).toEqual({ success: false, error: 'auth.validation.email_invalid' })
    expect(st.sendInvitation).not.toHaveBeenCalled()
  })

  it('cancelar una invitación: la admin la borra; una directora no llega a borrar', async () => {
    st.roles = ADMIN
    expect((await cancelarInvitacionDirectora(A, INVITACION)).success).toBe(true)
    expect(st.borrados).toHaveBeenCalledWith('invitaciones')
    vi.clearAllMocks()
    st.roles = DIRECTORA
    expect(await cancelarInvitacionDirectora(A, INVITACION)).toEqual(NO_AUTORIZADO)
    expect(st.borrados).not.toHaveBeenCalled()
  })

  it('cancelar una que ya no está pendiente: lo dice, no «hecho»', async () => {
    st.roles = ADMIN
    st.invitacionBorrada = null
    expect(await cancelarInvitacionDirectora(A, INVITACION)).toEqual({
      success: false,
      error: 'direccion.errors.invitacion_no_encontrada',
    })
  })
})

describe('traspasar la administración', () => {
  it('la admin traspasa: llama a traspasar_admin con la entrante', async () => {
    st.roles = ADMIN
    expect((await traspasarAdmin(A, OTRA)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('traspasar_admin', {
      p_centro_id: A,
      p_nueva_admin: OTRA,
    })
  })

  it('una directora no: no autorizado, sin llamar a la RPC', async () => {
    st.roles = DIRECTORA
    expect(await traspasarAdmin(A, OTRA)).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['42501', 'direccion.errors.solo_la_admin_traspasa'],
    ['23514', 'direccion.errors.solo_a_una_directora'],
    ['22023', 'direccion.errors.otra_persona'],
    ['XX000', 'direccion.errors.fallo'],
  ])('la RPC contesta %s → %s', async (code, error) => {
    st.roles = ADMIN
    st.rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } })
    expect(await traspasarAdmin(A, OTRA)).toEqual({ success: false, error })
  })
})

describe('dar de baja y dejar la dirección', () => {
  it('la admin da de baja a una directora: baja_de_direccion con ella', async () => {
    st.roles = ADMIN
    expect((await darDeBajaDirectora(A, OTRA)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('baja_de_direccion', { p_centro_id: A, p_usuario_id: OTRA })
  })

  it('una directora no da de baja a otra: no autorizado, sin llamar a la RPC', async () => {
    st.roles = DIRECTORA
    expect(await darDeBajaDirectora(A, OTRA)).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it('una directora deja la dirección: baja_de_direccion con ella misma', async () => {
    st.roles = DIRECTORA
    expect((await dejarLaDireccion(A)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('baja_de_direccion', { p_centro_id: A, p_usuario_id: YO })
  })

  it('la admin no la deja: la RPC contesta 55000 y sale el aviso de traspasar antes', async () => {
    st.roles = ADMIN
    st.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'x' } })
    expect(await dejarLaDireccion(A)).toEqual({
      success: false,
      error: 'direccion.errors.admin_primero_traspasa',
    })
  })

  it('quien no es Dirección no llega a la RPC', async () => {
    st.roles = PROFE
    expect(await dejarLaDireccion(A)).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })
})
