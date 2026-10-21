// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La baja del personal: baja temporal, salida del centro y reactivar. Las hace Dirección; quien no
 * lo es recibe «no autorizado» sin que la app llame a la RPC. La BD lo vuelve a comprobar
 * (`baja-personal.rls.test.ts`).
 */

const A = '00000000-0000-4000-8000-00000000000a'
const YO = '11111111-1111-4111-8111-111111111111'
const PROFE = '22222222-2222-4222-8222-222222222222'

const st = vi.hoisted(() => ({
  roles: [] as Array<{ centro_id: string; rol: string }>,
  rpc: vi.fn(),
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in']) b[m] = () => b
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

const { darDeBajaTemporal, darSalidaDelCentro, reactivarPersonal } =
  await import('../baja-personal')

const DIRECTORA = [{ centro_id: A, rol: 'directora' }]
const PROFE_ROL = [{ centro_id: A, rol: 'profe' }]
const NO_AUTORIZADO = { success: false, error: 'admin.personal.errors.no_autorizado' }

beforeEach(() => {
  vi.clearAllMocks()
  st.rpc.mockResolvedValue({ data: 1, error: null })
})

describe('dar de baja al personal', () => {
  it('Dirección da la baja temporal: dar_de_baja_profe con baja_temporal', async () => {
    st.roles = DIRECTORA
    expect((await darDeBajaTemporal(A, PROFE)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('dar_de_baja_profe', {
      p_centro_id: A,
      p_usuario_id: PROFE,
      p_motivo: 'baja_temporal',
    })
  })

  it('Dirección da la salida del centro: dar_de_baja_profe con salida_centro', async () => {
    st.roles = DIRECTORA
    expect((await darSalidaDelCentro(A, PROFE)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('dar_de_baja_profe', {
      p_centro_id: A,
      p_usuario_id: PROFE,
      p_motivo: 'salida_centro',
    })
  })

  it('una profe no: no autorizado, sin llamar a la RPC', async () => {
    st.roles = PROFE_ROL
    expect(await darDeBajaTemporal(A, PROFE)).toEqual(NO_AUTORIZADO)
    expect(await darSalidaDelCentro(A, PROFE)).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it('un id que no es un uuid: no autorizado, sin llamar a la RPC', async () => {
    st.roles = DIRECTORA
    expect(await darSalidaDelCentro(A, 'no-es-uuid')).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { code: '42501', error: 'admin.personal.errors.no_autorizado' },
    { code: 'P0002', error: 'admin.personal.errors.no_encontrada' },
    { code: 'XX000', error: 'admin.personal.errors.fallo' },
  ])('la RPC contesta $code → $error', async ({ code, error }) => {
    st.roles = DIRECTORA
    st.rpc.mockResolvedValue({ data: null, error: { code, message: 'x' } })
    expect(await darDeBajaTemporal(A, PROFE)).toEqual({ success: false, error })
  })
})

describe('reactivar a quien vuelve de una baja temporal', () => {
  it('Dirección la reactiva: reactivar_profe', async () => {
    st.roles = DIRECTORA
    expect((await reactivarPersonal(A, PROFE)).success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('reactivar_profe', { p_centro_id: A, p_usuario_id: PROFE })
  })

  it('una profe no: no autorizado, sin llamar a la RPC', async () => {
    st.roles = PROFE_ROL
    expect(await reactivarPersonal(A, PROFE)).toEqual(NO_AUTORIZADO)
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it('quien salió del centro no se reactiva (55000): vuelve con una invitación', async () => {
    st.roles = DIRECTORA
    st.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'x' } })
    expect(await reactivarPersonal(A, PROFE)).toEqual({
      success: false,
      error: 'admin.personal.errors.salio_del_centro',
    })
  })
})
