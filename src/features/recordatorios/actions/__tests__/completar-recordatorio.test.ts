import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { completarRecordatorioCore } from '../completar-recordatorio'

/**
 * Núcleo de `completarRecordatorio` (F6, 🔒 D6 / ADR-0036).
 *
 * Idempotencia + race safety: el UPDATE lleva `.is('completado_en', null)`. Si
 * vuelve 0 filas (data null, error null) → ya estaba completado o RLS rechazó →
 * `ya_completado`. Ejercemos:
 *  - happy path → success + UPDATE con completado_en/completado_por.
 *  - "ya completado / race" (0 filas) → ya_completado, no error duro.
 *  - 42501 (RLS) → no_autorizado.
 */

const USER_ID = '00000000-0000-0000-0000-000000000aaa'
const REC_ID = '00000000-0000-0000-0000-000000000111'

interface UpdateOutcome {
  affected: { id: string } | null
  error: { code?: string; message: string } | null
}

function makeFakeClient(outcome: UpdateOutcome) {
  const updateSpy = vi.fn()
  const isSpy = vi.fn()
  const fake = {
    from: (_table: string) => ({
      update: (patch: Record<string, unknown>) => {
        updateSpy(patch)
        return {
          eq: () => ({
            is: (col: string, val: unknown) => {
              isSpy(col, val)
              return {
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: outcome.affected, error: outcome.error }),
                }),
              }
            },
          }),
        }
      },
    }),
  } as unknown as SupabaseClient<Database>
  return { fake, updateSpy, isSpy }
}

describe('completarRecordatorioCore', () => {
  it('pendiente → success, UPDATE setea completado_en + completado_por', async () => {
    const { fake, updateSpy, isSpy } = makeFakeClient({ affected: { id: REC_ID }, error: null })

    const res = await completarRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(true)
    if (res.success) expect(res.data.recordatorio_id).toBe(REC_ID)
    // El guard de idempotencia: WHERE completado_en IS NULL.
    expect(isSpy).toHaveBeenCalledWith('completado_en', null)
    const patch = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(patch.completado_por).toBe(USER_ID)
    expect(typeof patch.completado_en).toBe('string')
  })

  it('ya completado / race (0 filas, error null) → ya_completado (no error duro)', async () => {
    const { fake } = makeFakeClient({ affected: null, error: null })

    const res = await completarRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.ya_completado')
  })

  it('RLS 42501 → no_autorizado', async () => {
    const { fake } = makeFakeClient({ affected: null, error: { code: '42501', message: 'rls' } })

    const res = await completarRecordatorioCore(fake, USER_ID, REC_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.no_autorizado')
  })
})
