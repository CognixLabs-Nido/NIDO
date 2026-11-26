import { describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, 2026-11-26): el listado de revocaciones con fotos pendientes, con la lectura caída. Antes,
 * «ninguna revocación pendiente»; ahora lanza y la pinta `admin/error.tsx`. Fixtures ficticios.
 */
const { r } = vi.hoisted(() => ({ r: { resp: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(r.resp).then(res)
      return c
    },
  }),
}))
const { getRevocacionesPendientes } = await import('../get-revocaciones-pendientes')

describe('getRevocacionesPendientes', () => {
  it('premisa: con la lectura bien, el niño con su pendiente', async () => {
    r.resp = {
      data: [{ nino_id: 'n-1', ninos: { nombre: 'Niño', apellidos: 'Demo' } }],
      error: null,
    }
    expect(await getRevocacionesPendientes('c-1')).toEqual([
      { ninoId: 'n-1', nombre: 'Niño', apellidos: 'Demo', pendientes: 1 },
    ])
  })

  it('con la lectura caída: no dice «ninguna», lanza', async () => {
    r.resp = { data: null, error: { code: 'XX000', message: 'caída' } }
    const e = await getRevocacionesPendientes('c-1').then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e)).toBe(true)
  })
})
