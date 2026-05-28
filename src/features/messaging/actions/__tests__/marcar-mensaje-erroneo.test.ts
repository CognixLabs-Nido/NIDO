import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { marcarMensajeErroneoCore } from '../marcar-mensaje-erroneo'

/**
 * Tests unitarios del núcleo de `marcarMensajeErroneo` (F5.6-B).
 *
 * Inyectamos un `SupabaseClient` falso para ejercer:
 *  - mensaje reciente <5 min → success + UPDATE con prefijo y flag.
 *  - mensaje >5 min → fail con `ventana_anulacion_expirada` sin tocar UPDATE.
 *  - UPDATE devuelve 42501 → mapeado al mismo error tipado (defensa
 *    en profundidad).
 *  - UPDATE devuelve 0 filas y error null (RLS USING rechaza
 *    silenciosamente) → mapeado a `ventana_anulacion_expirada`.
 *  - no autor / ya anulado se rechazan por sus respectivos errores
 *    antes de la comprobación de ventana (no deben colisionar).
 */

const USER_ID = '00000000-0000-0000-0000-000000000aaa'
const MENSAJE_ID = '00000000-0000-0000-0000-000000000111'

interface FakeMensaje {
  id: string
  autor_id: string
  contenido: string
  erroneo: boolean
  created_at: string
}

interface UpdateOutcome {
  affected: { id: string } | null
  error: { code?: string; message: string } | null
}

interface FakeSetup {
  selMensaje: FakeMensaje | null
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
            Promise.resolve({ data: setup.selMensaje, error: setup.selErr ?? null }),
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

describe('marcarMensajeErroneoCore — ventana 5 min', () => {
  it('mensaje reciente (<5 min): success, UPDATE prefijo + flag', async () => {
    const recent: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: USER_ID,
      contenido: 'hola',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({
      selMensaje: recent,
      updResult: { affected: { id: MENSAJE_ID }, error: null },
    })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(true)
    if (res.success) expect(res.data.mensaje_id).toBe(MENSAJE_ID)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0]?.[0]).toMatchObject({
      erroneo: true,
      contenido: '[anulado] hola',
    })
  })

  it('mensaje antiguo (>5 min): fail con ventana_anulacion_expirada, NO llama a UPDATE', async () => {
    const old: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: USER_ID,
      contenido: 'antiguo',
      erroneo: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selMensaje: old })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('UPDATE devuelve 42501 (defensa en profundidad): mapea a ventana_anulacion_expirada', async () => {
    const recent: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: USER_ID,
      contenido: 'hola',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake } = makeFakeClient({
      selMensaje: recent,
      updResult: { affected: null, error: { code: '42501', message: 'rls' } },
    })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
  })

  it('UPDATE 0 filas sin error (RLS USING silencioso): ventana_anulacion_expirada', async () => {
    // Race: pre-check pasó (mensaje a 4:59) pero el UPDATE alcanza la BD
    // un segundo más tarde y USING ya rechaza. Resultado: data=null,
    // error=null. Tiene que mapearse al mismo error tipado.
    const borderline: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: USER_ID,
      contenido: 'borde',
      erroneo: false,
      created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    }
    const { fake } = makeFakeClient({
      selMensaje: borderline,
      updResult: { affected: null, error: null },
    })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ventana_anulacion_expirada')
  })

  it('no autor: rechazado con no_autorizado (no por ventana)', async () => {
    const recent: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: 'otro-user',
      contenido: 'hola',
      erroneo: false,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selMensaje: recent })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.no_autorizado')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('ya anulado: rechazado con ya_anulado (no por ventana)', async () => {
    const recent: FakeMensaje = {
      id: MENSAJE_ID,
      autor_id: USER_ID,
      contenido: '[anulado] hola',
      erroneo: true,
      created_at: new Date(Date.now() - 60_000).toISOString(),
    }
    const { fake, updateSpy } = makeFakeClient({ selMensaje: recent })

    const res = await marcarMensajeErroneoCore(fake, USER_ID, MENSAJE_ID)

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('messages.errors.ya_anulado')
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
