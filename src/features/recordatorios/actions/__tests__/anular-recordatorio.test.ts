import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { anularRecordatorioCore } from '../anular-recordatorio'

/**
 * Núcleo de `anularRecordatorio` (F6). Mismo patrón que mensajería: flag
 * erroneo + prefijo `[anulado] `, solo emisor, ventana 5 min en el ACTION.
 *
 * Casos:
 *  - reciente (<5 min) + emisor → success + UPDATE con prefijo y flag.
 *  - >5 min → ventana_anulacion_expirada sin tocar UPDATE.
 *  - no emisor → no_autorizado.
 *  - ya anulado → ya_anulado.
 *  - UPDATE 0 filas (RLS USING) → no_autorizado.
 */

const USER_ID = '00000000-0000-0000-0000-000000000aaa'
const REC_ID = '00000000-0000-0000-0000-000000000111'

interface FakeRec {
  id: string
  creado_por: string
  titulo: string
  erroneo: boolean
  created_at: string
}

interface UpdateOutcome {
  affected: { id: string } | null
  error: { code?: string; message: string } | null
}

interface FakeSetup {
  selRec: FakeRec | null
  selErr?: { message: string } | null
  updResult?: UpdateOutcome
}

function makeFakeClient(setup: FakeSetup) {
  const updateSpy = vi.fn()
  const fake = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: setup.selRec, error: setup.selErr ?? null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updateSpy(patch)
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: setup.updResult?.affected ?? null,
                  error: setup.updResult?.error ?? null,
                }),
            }),
          }),
        }
      },
    }),
  } as unknown as SupabaseClient<Database>
  return { fake, updateSpy }
}

describe('anularRecordatorioCore — ventana 5 min', () => {
  it('reciente (<5 min) + emisor: success, UPDATE prefijo + flag', async () => {
    const rec: FakeRec = {
      id: REC_ID,
      creado_por: USER_ID,
      titulo: 'traer pañales',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({
      selRec: rec,
      updResult: { affected: { id: REC_ID }, error: null },
    })

    const res = await anularRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(true)
    expect(updateSpy.mock.calls[0]?.[0]).toMatchObject({
      erroneo: true,
      titulo: '[anulado] traer pañales',
    })
  })

  it('>5 min: ventana_anulacion_expirada sin tocar UPDATE', async () => {
    const rec: FakeRec = {
      id: REC_ID,
      creado_por: USER_ID,
      titulo: 'antiguo',
      erroneo: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selRec: rec })

    const res = await anularRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.ventana_anulacion_expirada')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('no emisor: no_autorizado', async () => {
    const rec: FakeRec = {
      id: REC_ID,
      creado_por: 'otro-user',
      titulo: 'x',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selRec: rec })

    const res = await anularRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.no_autorizado')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('ya anulado: ya_anulado', async () => {
    const rec: FakeRec = {
      id: REC_ID,
      creado_por: USER_ID,
      titulo: '[anulado] x',
      erroneo: true,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selRec: rec })

    const res = await anularRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.ya_anulado')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('UPDATE 0 filas (RLS USING silencioso): no_autorizado', async () => {
    const rec: FakeRec = {
      id: REC_ID,
      creado_por: USER_ID,
      titulo: 'borde',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake } = makeFakeClient({ selRec: rec, updResult: { affected: null, error: null } })

    const res = await anularRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.no_autorizado')
  })
})
