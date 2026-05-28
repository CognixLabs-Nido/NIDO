import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { marcarAnuncioErroneoCore } from '../marcar-anuncio-erroneo'

/**
 * Tests unitarios del núcleo de `marcarAnuncioErroneo` (F5.6-B).
 * Misma estrategia que el test de mensajes: fake `SupabaseClient`
 * inyectado por argumento.
 */

const USER_ID = '00000000-0000-0000-0000-000000000bbb'
const ANUNCIO_ID = '00000000-0000-0000-0000-000000000222'

interface FakeAnuncio {
  id: string
  autor_id: string
  titulo: string
  erroneo: boolean
  created_at: string
}

interface UpdateOutcome {
  affected: { id: string } | null
  error: { code?: string; message: string } | null
}

interface FakeSetup {
  selAnuncio: FakeAnuncio | null
  selErr?: { message: string } | null
  updResult?: UpdateOutcome
}

function makeFakeClient(setup: FakeSetup) {
  const updateSpy = vi.fn()
  const fake = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: setup.selAnuncio, error: setup.selErr ?? null }),
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

describe('marcarAnuncioErroneoCore — ventana 5 min', () => {
  it('anuncio reciente (<5 min): success, UPDATE prefijo en titulo + flag', async () => {
    const recent: FakeAnuncio = {
      id: ANUNCIO_ID,
      autor_id: USER_ID,
      titulo: 'fiesta',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({
      selAnuncio: recent,
      updResult: { affected: { id: ANUNCIO_ID }, error: null },
    })

    const res = await marcarAnuncioErroneoCore(fake, USER_ID, ANUNCIO_ID)

    expect(res.success).toBe(true)
    if (res.success) expect(res.data.anuncio_id).toBe(ANUNCIO_ID)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]?.[0]).toMatchObject({
      erroneo: true,
      titulo: '[anulado] fiesta',
    })
  })

  it('anuncio antiguo (>5 min): fail con ventana_anulacion_expirada, NO llama a UPDATE', async () => {
    const old: FakeAnuncio = {
      id: ANUNCIO_ID,
      autor_id: USER_ID,
      titulo: 'viejo',
      erroneo: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selAnuncio: old })

    const res = await marcarAnuncioErroneoCore(fake, USER_ID, ANUNCIO_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('UPDATE devuelve 42501: mapea a ventana_anulacion_expirada', async () => {
    const recent: FakeAnuncio = {
      id: ANUNCIO_ID,
      autor_id: USER_ID,
      titulo: 'fiesta',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake } = makeFakeClient({
      selAnuncio: recent,
      updResult: { affected: null, error: { code: '42501', message: 'rls' } },
    })

    const res = await marcarAnuncioErroneoCore(fake, USER_ID, ANUNCIO_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
  })

  it('UPDATE 0 filas sin error (RLS USING silencioso): ventana_anulacion_expirada', async () => {
    const borderline: FakeAnuncio = {
      id: ANUNCIO_ID,
      autor_id: USER_ID,
      titulo: 'limite',
      erroneo: false,
      created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    }
    const { fake } = makeFakeClient({
      selAnuncio: borderline,
      updResult: { affected: null, error: null },
    })

    const res = await marcarAnuncioErroneoCore(fake, USER_ID, ANUNCIO_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
  })

  it('no autor: rechazado con no_autorizado (no por ventana)', async () => {
    const recent: FakeAnuncio = {
      id: ANUNCIO_ID,
      autor_id: 'otro-user',
      titulo: 'fiesta',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selAnuncio: recent })

    const res = await marcarAnuncioErroneoCore(fake, USER_ID, ANUNCIO_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.no_autorizado')
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
