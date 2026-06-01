import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

// El push es best-effort al final; lo neutralizamos para no tocar audiencia/push.
vi.mock('../../lib/notificar', () => ({
  notificarEvento: vi.fn(() => Promise.resolve()),
  notificarCancelacion: vi.fn(() => Promise.resolve()),
}))

import { crearEventoCore } from '../crear-evento'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NINO_ID = '22222222-2222-4222-8222-222222222222'
const CENTRO_ID = '33333333-3333-4333-8333-333333333333'
const EVENTO_ID = '44444444-4444-4444-8444-444444444444'
const AULA_ID = '55555555-5555-4555-8555-555555555555'

interface FakeSetup {
  ninoCentro?: string | null
  aulaCentro?: string | null
  rolCentro?: string | null
  insertResult?: { id: string } | null
  insertError?: { code?: string; message: string } | null
}

function makeFakeClient(setup: FakeSetup) {
  const insertSpy = vi.fn()
  const fake = {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.limit = () => b
      b.insert = (payload: Record<string, unknown>) => {
        insertSpy(payload)
        return b
      }
      b.maybeSingle = () => {
        if (table === 'ninos') {
          return Promise.resolve({
            data: setup.ninoCentro === undefined ? null : { centro_id: setup.ninoCentro },
            error: null,
          })
        }
        if (table === 'aulas') {
          return Promise.resolve({
            data: setup.aulaCentro === undefined ? null : { centro_id: setup.aulaCentro },
            error: null,
          })
        }
        if (table === 'roles_usuario') {
          return Promise.resolve({
            data: setup.rolCentro ? { centro_id: setup.rolCentro } : null,
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      b.single = () =>
        Promise.resolve({ data: setup.insertResult ?? null, error: setup.insertError ?? null })
      return b
    },
  } as unknown as SupabaseClient<Database>
  return { fake, insertSpy }
}

const baseInput = {
  tipo: 'excursion' as const,
  titulo: 'Excursión',
  fecha: '2026-09-10',
}

describe('crearEventoCore', () => {
  it('crea un evento de centro resolviendo centro_id del usuario', async () => {
    const { fake, insertSpy } = makeFakeClient({
      rolCentro: CENTRO_ID,
      insertResult: { id: EVENTO_ID },
    })
    const res = await crearEventoCore(fake, USER_ID, { ambito: 'centro', ...baseInput })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.evento_id).toBe(EVENTO_ID)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        centro_id: CENTRO_ID,
        ambito: 'centro',
        aula_id: null,
        nino_id: null,
        creado_por: USER_ID,
      })
    )
  })

  it('crea un evento de niño resolviendo centro_id del niño', async () => {
    const { fake, insertSpy } = makeFakeClient({
      ninoCentro: CENTRO_ID,
      insertResult: { id: EVENTO_ID },
    })
    const res = await crearEventoCore(fake, USER_ID, {
      ambito: 'nino',
      nino_id: NINO_ID,
      ...baseInput,
    })
    expect(res.success).toBe(true)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ambito: 'nino', nino_id: NINO_ID, aula_id: null })
    )
  })

  it('falla si el INSERT devuelve 42501 (RLS)', async () => {
    const { fake } = makeFakeClient({
      aulaCentro: CENTRO_ID,
      insertResult: null,
      insertError: { code: '42501', message: 'rls' },
    })
    const res = await crearEventoCore(fake, USER_ID, {
      ambito: 'aula',
      aula_id: AULA_ID,
      ...baseInput,
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('eventos.errors.no_autorizado')
  })

  it('rechaza input inválido (ámbito nino sin nino_id)', async () => {
    const { fake } = makeFakeClient({ rolCentro: CENTRO_ID })
    const res = await crearEventoCore(fake, USER_ID, { ambito: 'nino', ...baseInput })
    expect(res.success).toBe(false)
  })
})
