import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fix Fase 1 — `acceptInvitation` debe COMPLETAR el stub de `inviteUserByEmail` en
 * vez de crear de cero, y solo rechazar cuentas REALES:
 *  - 'stub' (auth.users sin roles)  → `updateUserById` (set password) + roles/consents/vínculo.
 *  - 'real' (auth.users con roles)  → fail('email_already_registered') (va por B8).
 *  - 'nueva' (sin auth.users)       → `createUser` (camino original intacto).
 *
 * Se mockean los clientes Supabase (service role + server) con un builder thenable,
 * y `getRequestContext`. Las invitaciones son de rol familiar con `nino_id`, así que
 * el camino feliz ejercita también consents + auto-vínculo.
 */

const TOKEN = '550e8400-e29b-41d4-a716-446655440000'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const NINO = '22222222-2222-4222-8222-222222222222'

// Configurables por test.
let usersFixture: Array<{ id: string; email: string }>
let rolesParaUsuario: Array<{ usuario_id: string }>

// Spies de auth admin.
let updateSpy: ReturnType<typeof vi.fn>
let createSpy: ReturnType<typeof vi.fn>
let deleteSpy: ReturnType<typeof vi.fn>
let signInSpy: ReturnType<typeof vi.fn>

const INVITATION_ROW = {
  id: 'inv-1',
  email: 'tutor@nido.test',
  rol_objetivo: 'tutor_legal',
  centro_id: CENTRO,
  nino_id: NINO,
  aula_id: null,
  tipo_vinculo: 'tutor_legal_principal',
  expires_at: '2999-01-01T00:00:00.000Z',
  accepted_at: null,
  rejected_at: null,
}

function makeServiceFake() {
  function builder(table: string) {
    const state = { table, op: 'select' as 'select' | 'insert' | 'update' | 'upsert' }
    const result = () => {
      if (table === 'invitaciones') {
        if (state.op === 'update') return { data: null, error: null }
        return { data: INVITATION_ROW, error: null }
      }
      if (table === 'roles_usuario') {
        if (state.op === 'insert') return { error: null }
        return { data: rolesParaUsuario, error: null }
      }
      if (table === 'vinculos_familiares') return { error: null }
      // F-2b-2b: backfill del perfil. `ninos` → familia del niño; `familia_tutores` select →
      // candidatos pendientes (casa por email de la invitación); update → fila enlazada.
      if (table === 'ninos') return { data: { familia_id: 'fam-1' }, error: null }
      if (table === 'familia_tutores') {
        if (state.op === 'update') return { data: { id: 'ft-1' }, error: null }
        return { data: [{ id: 'ft-1', email: INVITATION_ROW.email }], error: null }
      }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => {
      state.op = 'select'
      return self()
    }
    b.insert = () => {
      state.op = 'insert'
      return self()
    }
    b.update = () => {
      state.op = 'update'
      return self()
    }
    b.upsert = () => {
      state.op = 'upsert'
      return self()
    }
    b.delete = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.limit = () => self()
    b.maybeSingle = () => self()
    b.single = () => self()
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  return {
    from: (table: string) => builder(table),
    rpc: vi.fn(() => Promise.resolve({ error: null })),
    auth: {
      admin: {
        listUsers: vi.fn(() => Promise.resolve({ data: { users: usersFixture }, error: null })),
        updateUserById: updateSpy,
        createUser: createSpy,
        deleteUser: deleteSpy,
      },
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { signInWithPassword: signInSpy },
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => makeServiceFake(),
}))

vi.mock('@/features/autorizaciones/lib/request-context', () => ({
  getRequestContext: vi.fn(() => Promise.resolve({ ip: '1.2.3.4', userAgent: 'test' })),
}))

// En ÉXITO la action navega server-side con `redirect()`; lo mockeamos como spy no-op
// para poder afirmar el destino (panel por rol) sin que lance NEXT_REDIRECT en el test.
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { redirect } from 'next/navigation'

import { acceptInvitation } from '../actions/accept-invitation'

const VALID_INPUT = {
  token: TOKEN,
  nombreCompleto: 'María Tutora',
  password: 'Password1234!',
  idiomaPreferido: 'es' as const,
  aceptaTerminos: true as const,
  aceptaPrivacidad: true as const,
  parentesco: 'madre' as const,
}

beforeEach(() => {
  usersFixture = []
  rolesParaUsuario = []
  updateSpy = vi.fn(() => Promise.resolve({ data: { user: { id: 'stub-id' } }, error: null }))
  createSpy = vi.fn(() => Promise.resolve({ data: { user: { id: 'new-id' } }, error: null }))
  deleteSpy = vi.fn(() => Promise.resolve({ error: null }))
  signInSpy = vi.fn(() => Promise.resolve({ error: null }))
  vi.mocked(redirect).mockClear()
})

describe('acceptInvitation — completar stub vs crear vs rechazar', () => {
  it('STUB (auth.users sin roles) → updateUserById, NO createUser, alta OK', async () => {
    usersFixture = [{ id: 'stub-id', email: 'tutor@nido.test' }]
    rolesParaUsuario = [] // sin roles → stub

    await acceptInvitation(VALID_INPUT)

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(
      'stub-id',
      expect.objectContaining({ password: 'Password1234!', email_confirm: true })
    )
    expect(createSpy).not.toHaveBeenCalled()
    // El alta completa: login automático tras aceptar.
    expect(signInSpy).toHaveBeenCalledTimes(1)
    // …y redirección server-side al panel del rol (tutor_legal → /family; el gate P3c
    // reenvía a /alta). locale por defecto 'es'.
    expect(redirect).toHaveBeenCalledWith('/es/family')
  })

  it('REAL (auth.users con roles) → email_already_registered, sin update ni create', async () => {
    usersFixture = [{ id: 'real-id', email: 'tutor@nido.test' }]
    rolesParaUsuario = [{ usuario_id: 'real-id' }] // con roles → cuenta real

    const r = await acceptInvitation(VALID_INPUT)

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.email_already_registered')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('NUEVA (sin auth.users) → createUser, NO updateUserById, alta OK', async () => {
    usersFixture = [] // email totalmente nuevo

    await acceptInvitation(VALID_INPUT)

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(signInSpy).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith('/es/family')
  })
})
