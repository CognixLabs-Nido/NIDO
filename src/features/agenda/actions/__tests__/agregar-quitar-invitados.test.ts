import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

const explicitosMock = vi.fn()
vi.mock('../../lib/invitados', () => ({
  resolverInvitadosExplicitos: (...args: unknown[]) => explicitosMock(...args),
}))

import { agregarInvitadosCore } from '../agregar-invitados'
import { quitarInvitadoCore } from '../quitar-invitado'

const USER = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const CITA = '44444444-4444-4444-8444-444444444444'
const INV = '66666666-6666-4666-8666-666666666666'
// usuario_id del input debe ser uuid válido (el schema lo valida); la expansión
// real está mockeada, así que su valor concreto da igual para estos asserts.
const U_IN = '77777777-7777-4777-8777-777777777777'

beforeEach(() => vi.clearAllMocks())

describe('agregarInvitadosCore', () => {
  function makeFake(opts: {
    cita?: {
      centro_id: string
      organizador_id: string
      aula_id: string | null
      estado: string
    } | null
    existentes?: { usuario_id: string }[]
    insertError?: { message: string } | null
  }) {
    const insertSpy = vi.fn()
    const fake = {
      rpc: () => Promise.resolve({ data: false, error: null }),
      from: (table: string) => {
        const b: Record<string, unknown> = {}
        b.select = () => b
        b.eq = () => b
        b.maybeSingle = () => Promise.resolve({ data: opts.cita ?? null, error: null })
        b.not = () => Promise.resolve({ data: opts.existentes ?? [], error: null })
        b.insert = (payload: unknown) => {
          insertSpy(payload)
          return Promise.resolve({ error: opts.insertError ?? null })
        }
        void table
        return b
      },
    } as unknown as SupabaseClient<Database>
    return { fake, insertSpy }
  }

  it('deduplica contra los ya invitados y materializa solo los nuevos', async () => {
    explicitosMock.mockResolvedValue({ internos: ['t1', 't2'], externos: [] })
    const { fake, insertSpy } = makeFake({
      cita: { centro_id: CENTRO, organizador_id: USER, aula_id: null, estado: 'programada' },
      existentes: [{ usuario_id: 't1' }],
    })
    const res = await agregarInvitadosCore(fake, USER, {
      cita_id: CITA,
      invitados: [{ tipo: 'usuario', usuario_id: U_IN }],
    })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.agregados).toBe(1)
    expect(insertSpy).toHaveBeenCalledWith([{ cita_id: CITA, centro_id: CENTRO, usuario_id: 't2' }])
  })

  it('rechaza añadir a una cita cancelada', async () => {
    const { fake } = makeFake({
      cita: { centro_id: CENTRO, organizador_id: USER, aula_id: null, estado: 'cancelada' },
    })
    const res = await agregarInvitadosCore(fake, USER, {
      cita_id: CITA,
      invitados: [{ tipo: 'usuario', usuario_id: U_IN }],
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.cita_cancelada')
  })

  it('no inserta si no hay invitados nuevos (todos ya estaban)', async () => {
    explicitosMock.mockResolvedValue({ internos: ['t1'], externos: [] })
    const { fake, insertSpy } = makeFake({
      cita: { centro_id: CENTRO, organizador_id: USER, aula_id: null, estado: 'programada' },
      existentes: [{ usuario_id: 't1' }],
    })
    const res = await agregarInvitadosCore(fake, USER, {
      cita_id: CITA,
      invitados: [{ tipo: 'usuario', usuario_id: U_IN }],
    })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.agregados).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe('quitarInvitadoCore', () => {
  function makeFake(deleted: { id: string } | null) {
    const fake = {
      from: () => {
        const b: Record<string, unknown> = {}
        b.delete = () => b
        b.eq = () => b
        b.select = () => b
        b.maybeSingle = () => Promise.resolve({ data: deleted, error: null })
        return b
      },
    } as unknown as SupabaseClient<Database>
    return fake
  }

  it('borra la fila cuando la RLS lo permite', async () => {
    const res = await quitarInvitadoCore(makeFake({ id: INV }), { invitado_id: INV })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.invitado_id).toBe(INV)
  })

  it('devuelve no_autorizado si el DELETE no toca ninguna fila (RLS)', async () => {
    const res = await quitarInvitadoCore(makeFake(null), { invitado_id: INV })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.no_autorizado')
  })
})
