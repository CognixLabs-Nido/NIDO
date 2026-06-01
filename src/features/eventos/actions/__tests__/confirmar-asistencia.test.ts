import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { confirmarAsistenciaCore } from '../confirmar-asistencia'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NINO_ID = '22222222-2222-4222-8222-222222222222'
const EVENTO_ID = '44444444-4444-4444-8444-444444444444'
const CONF_ID = '77777777-7777-4777-8777-777777777777'

interface FakeSetup {
  evento?: { fecha: string; estado: string; requiere_confirmacion: boolean } | null
  upsertResult?: { id: string } | null
  upsertError?: { code?: string; message: string } | null
}

function makeFakeClient(setup: FakeSetup) {
  const upsertSpy = vi.fn()
  const fake = {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.upsert = (payload: Record<string, unknown>) => {
        upsertSpy(payload)
        return b
      }
      b.maybeSingle = () => {
        if (table === 'eventos') {
          return Promise.resolve({ data: setup.evento ?? null, error: null })
        }
        if (table === 'confirmaciones_evento') {
          return Promise.resolve({
            data: setup.upsertResult ?? null,
            error: setup.upsertError ?? null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      return b
    },
  } as unknown as SupabaseClient<Database>
  return { fake, upsertSpy }
}

const input = { evento_id: EVENTO_ID, nino_id: NINO_ID, estado: 'confirmado' as const }

describe('confirmarAsistenciaCore', () => {
  it('confirma asistencia dentro de la ventana', async () => {
    const { fake, upsertSpy } = makeFakeClient({
      evento: { fecha: '2999-01-01', estado: 'programado', requiere_confirmacion: true },
      upsertResult: { id: CONF_ID },
    })
    const res = await confirmarAsistenciaCore(fake, USER_ID, input)
    expect(res.success).toBe(true)
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        evento_id: EVENTO_ID,
        nino_id: NINO_ID,
        estado: 'confirmado',
        confirmado_por: USER_ID,
      })
    )
  })

  it('rechaza si el evento está cancelado', async () => {
    const { fake } = makeFakeClient({
      evento: { fecha: '2999-01-01', estado: 'cancelado', requiere_confirmacion: true },
    })
    const res = await confirmarAsistenciaCore(fake, USER_ID, input)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('eventos.errors.evento_cancelado')
  })

  it('rechaza si el evento no requiere confirmación', async () => {
    const { fake } = makeFakeClient({
      evento: { fecha: '2999-01-01', estado: 'programado', requiere_confirmacion: false },
    })
    const res = await confirmarAsistenciaCore(fake, USER_ID, input)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('eventos.errors.no_requiere_confirmacion')
  })

  it('rechaza fuera de la ventana (fecha pasada)', async () => {
    const { fake } = makeFakeClient({
      evento: { fecha: '2000-01-01', estado: 'programado', requiere_confirmacion: true },
    })
    const res = await confirmarAsistenciaCore(fake, USER_ID, input)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('eventos.errors.ventana_cerrada')
  })

  it('devuelve no_encontrado si el evento no es visible (RLS)', async () => {
    const { fake } = makeFakeClient({ evento: null })
    const res = await confirmarAsistenciaCore(fake, USER_ID, input)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('eventos.errors.no_encontrado')
  })
})
