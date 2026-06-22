import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pieza 2b — el dedupe de `sendInvitation` debe ser **nino_id-aware**:
 *  (1) mismo tutor + mismo niño re-invitar → encuentra la abierta → UPDATE (no duplica).
 *  (2) mismo tutor + 2.º niño distinto → NO la encuentra → INSERT (sin clobber del 1.º).
 *  (3) admin/profe (sin nino_id) → dedupe con `.is('nino_id', null)`, comportamiento intacto.
 *
 * Se mockean los clientes Supabase (server + service role) con un builder "thenable"
 * que registra qué filtro de `nino_id` se aplicó y si la operación fue INSERT o UPDATE.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const NINO_A = '22222222-2222-4222-8222-222222222222'
const NINO_B = '44444444-4444-4444-8444-444444444444'

// Estado registrado por el service-fake en cada llamada a sendInvitation.
let calls: {
  insert: number
  update: number
  ninoFilter: { type: 'eq' | 'is'; value: unknown } | null
}
// Qué niños tienen ya invitación abierta (para simular el dedupe).
let existingForNino: Record<string, boolean>

function makeServiceFake() {
  function builder(table: string) {
    const state = {
      table,
      selectCols: '',
      isInsert: false,
      isUpdate: false,
      ninoFilter: null as null | { type: 'eq' | 'is'; value: unknown },
    }
    const result = () => {
      if (state.isUpdate) return { data: null, error: null }
      if (state.isInsert) return { data: { id: 'new-id', token: 'tok' }, error: null }
      if (state.selectCols.includes('token') && !state.selectCols.includes('id,'))
        return { data: { token: 'tok' }, error: null }
      // dedupe (select 'id') sobre invitaciones
      if (state.table === 'invitaciones') {
        const key = state.ninoFilter?.type === 'eq' ? String(state.ninoFilter.value) : '__null__'
        return { data: existingForNino[key] ? { id: 'existing-id' } : null, error: null }
      }
      // roles_usuario u otros selects de lista
      return { data: [{ rol: 'admin', centro_id: CENTRO }], error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = (c: string) => {
      state.selectCols = c
      return self()
    }
    b.insert = () => {
      state.isInsert = true
      if (state.table === 'invitaciones') calls.insert++
      return self()
    }
    b.update = () => {
      state.isUpdate = true
      if (state.table === 'invitaciones') calls.update++
      return self()
    }
    b.eq = (col: string, val: unknown) => {
      if (col === 'nino_id') {
        state.ninoFilter = { type: 'eq', value: val }
        calls.ninoFilter = state.ninoFilter
      }
      return self()
    }
    b.is = (col: string, val: unknown) => {
      if (col === 'nino_id') {
        state.ninoFilter = { type: 'is', value: val }
        calls.ninoFilter = state.ninoFilter
      }
      return self()
    }
    b.limit = () => self()
    b.maybeSingle = () => self()
    b.single = () => self()
    // thenable: cualquier await en cualquier punto resuelve el resultado calculado.
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  return {
    from: (table: string) => builder(table),
    auth: { admin: { inviteUserByEmail: vi.fn(() => Promise.resolve({ error: null })) } },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: ADMIN } } }) },
      from: () => {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = () => b
        b.is = () => b
        b.then = (resolve: (v: unknown) => void) =>
          resolve({ data: [{ rol: 'admin', centro_id: CENTRO }], error: null })
        return b
      },
    })
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => makeServiceFake(),
}))

import { sendInvitation } from '../actions/send-invitation'

beforeEach(() => {
  calls = { insert: 0, update: 0, ninoFilter: null }
  existingForNino = {}
})

describe('sendInvitation — dedupe nino_id-aware', () => {
  it('(1) mismo tutor + mismo niño con invitación abierta → UPDATE, no duplica', async () => {
    existingForNino = { [NINO_A]: true }
    const r = await sendInvitation({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: CENTRO,
      ninoId: NINO_A,
      tipoVinculo: 'tutor_legal_principal',
    })
    expect(r.success).toBe(true)
    expect(calls.ninoFilter).toEqual({ type: 'eq', value: NINO_A })
    expect(calls.update).toBe(1)
    expect(calls.insert).toBe(0)
  })

  it('(2) mismo tutor + 2.º niño distinto → INSERT (no clobbea la del 1.º)', async () => {
    existingForNino = { [NINO_A]: true } // abierta para A, no para B
    const r = await sendInvitation({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: CENTRO,
      ninoId: NINO_B,
      tipoVinculo: 'tutor_legal_principal',
    })
    expect(r.success).toBe(true)
    expect(calls.ninoFilter).toEqual({ type: 'eq', value: NINO_B })
    expect(calls.insert).toBe(1)
    expect(calls.update).toBe(0)
  })

  it('(3) admin sin nino_id → dedupe con is(nino_id, null), comportamiento intacto', async () => {
    const r = await sendInvitation({
      email: 'nuevo-admin@nido.test',
      rolObjetivo: 'admin',
      centroId: CENTRO,
    })
    expect(r.success).toBe(true)
    expect(calls.ninoFilter).toEqual({ type: 'is', value: null })
    expect(calls.insert).toBe(1)
  })
})
