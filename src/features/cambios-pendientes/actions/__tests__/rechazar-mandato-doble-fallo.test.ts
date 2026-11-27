import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, 2026-11-26): rechazar un mandato propuesto de la cola. Si marcarlo «rechazado» falla, la
 * entrada vuelve a pendiente; esa vuelta se esperaba y se tiraba. Si fallaba también, la entrada quedaba
 * rechazada con su mandato «propuesto» (bloquea la siguiente propuesta) sin que nadie lo supiera. El arreglo
 * de diseño se propone para B2 con el doble fallo de aprobarCambio; aquí, que vaya a Sentry.
 * Fixtures ficticios.
 */
const { bd, logError } = vi.hoisted(() => ({
  bd: { volverFalla: false, updates: 0 },
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
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => {
      const c: Record<string, unknown> = {}
      c.update = () => {
        bd.updates++
        return c
      }
      c.eq = () => c
      c.select = () => c
      // 1.er update: marcar rechazada (devuelve la fila). 2.º: volver a pendiente (thenable).
      c.maybeSingle = async () => ({
        data: {
          id: 'cp-1',
          entidad: 'mandato_sepa',
          centro_id: 'c-1',
          nino_id: null,
          payload: { mandato_id: '00000000-0000-4000-8000-000000000009' },
        },
        error: null,
      })
      c.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ error: bd.volverFalla ? { code: 'XX000', message: 'no' } : null }).then(
          res
        )
      return c
    },
  }),
}))
const { rechazarCambio } = await import('../decidir')
const ID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  bd.volverFalla = false
  bd.updates = 0
  logError.mockClear()
})

describe('rechazarCambio de un mandato', () => {
  it('premisa: el mandato no se marca, la entrada vuelve a pendiente y nada va a Sentry', async () => {
    expect(await rechazarCambio(ID)).toEqual({
      success: false,
      error: 'admin.pendientes.errors.decidir',
    })
    expect(bd.updates, 'premisa: intentó devolverla').toBe(2)
    expect(logError).not.toHaveBeenCalled()
  })

  it('si tampoco vuelve a pendiente: va a Sentry', async () => {
    bd.volverFalla = true
    await rechazarCambio(ID)
    expect(logError.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('devolver a pendiente')
    )
  })
})
