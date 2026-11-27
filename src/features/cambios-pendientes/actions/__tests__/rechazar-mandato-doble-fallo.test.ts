import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rechazar un mandato propuesto de la cola. Hasta B2 (censo C, B1, 2026-11-26) la entrada se marcaba
 * «rechazado» ANTES de que la base rechazara el mandato y, si eso fallaba, se devolvía a pendiente; si la
 * vuelta fallaba también, quedaba rechazada con su mandato «propuesto» (bloquea la siguiente propuesta).
 * Desde B2 (2026-11-27, «un cambio NUNCA sale de la cola si no se aplicó») la entrada se reserva sin salir
 * de 'pendiente'; si la base no rechaza el mandato, una escritura deja «falló al aplicar»
 * (`rechazar_mandato`) y la entrada nunca se marca rechazada. Si esa escritura falla también, la entrada
 * sigue pendiente y reservada, y va a Sentry. La misma regla contra la base de verdad:
 * `src/test/rls/aprobar-cambio-doble-fallo.rls.test.ts`. Fixtures ficticios.
 */
const { bd, logError } = vi.hoisted(() => ({
  bd: {
    marcarFalla: false,
    rpcs: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    updates: [] as unknown[],
  },
  logError: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: logError, warn: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('../../lib/aplicar', () => ({
  aplicarCambioPendiente: vi.fn(),
  decidirMandato: async () => {
    throw new Error('la base no lo marcó')
  },
  descartarCambioPendiente: async () => {},
  RutaDocumentoInvalidaError: class extends Error {},
}))
const DESDE = '2026-11-27T10:00:00.000000+00:00'
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      bd.rpcs.push({ fn, args })
      if (fn === 'reclamar_cambio_pendiente')
        return {
          data: {
            estado: 'reservado',
            fila: {
              id: 'cp-1',
              entidad: 'mandato_sepa',
              centro_id: 'c-1',
              nino_id: 'n-1',
              payload: { mandato_id: '00000000-0000-4000-8000-000000000009' },
              aplicando_desde: DESDE,
              invita_tutor2: null,
            },
          },
          error: null,
        }
      if (fn === 'marcar_fallo_cambio_pendiente')
        return bd.marcarFalla
          ? { data: null, error: { code: 'XX000', message: 'no' } }
          : { data: true, error: null }
      throw new Error(`rpc inesperada: ${fn}`)
    },
    from: () => {
      const c: Record<string, unknown> = {}
      c.update = (v: unknown) => {
        bd.updates.push(v)
        return c
      }
      c.eq = () => c
      c.select = () => c
      c.maybeSingle = async () => ({ data: null, error: null })
      c.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
      return c
    },
  }),
}))
const { rechazarCambio } = await import('../decidir')
const ID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  bd.marcarFalla = false
  bd.rpcs = []
  bd.updates = []
  logError.mockClear()
})

describe('rechazarCambio de un mandato que la base no rechaza', () => {
  it('se marca «falló al aplicar» sobre su reserva y la entrada nunca se marca rechazada', async () => {
    expect(await rechazarCambio(ID)).toEqual({
      success: false,
      error: 'admin.pendientes.errors.decidir',
    })
    // Premisa: se reservó.
    expect(bd.rpcs[0]?.fn).toBe('reclamar_cambio_pendiente')
    expect(bd.rpcs).toContainEqual({
      fn: 'marcar_fallo_cambio_pendiente',
      args: { p_cambio: 'cp-1', p_desde: DESDE, p_motivo: 'rechazar_mandato' },
    })
    expect(bd.updates).toEqual([])
    expect(logError).not.toHaveBeenCalled()
  })

  it('si marcar el fallo también falla: sigue sin marcarse rechazada, y va a Sentry', async () => {
    bd.marcarFalla = true
    await rechazarCambio(ID)
    expect(bd.rpcs.map((r) => r.fn)).toContain('marcar_fallo_cambio_pendiente')
    expect(bd.updates).toEqual([])
    expect(logError.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('marcar «falló al aplicar»')
    )
  })
})
