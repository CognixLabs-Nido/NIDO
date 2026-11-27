import { describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, 2026-11-26): `familiaTieneMandatoActivo` con la lectura caída. Antes daba `null`, igual que
 * «la familia no tiene mandato», y la pantalla pedía firmar otro. Ahora lanza. Fixtures ficticios.
 */
const { r } = vi.hoisted(() => ({ r: { resp: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) c[m] = () => c
      c.maybeSingle = async () => r.resp
      return c
    },
  }),
}))
const { familiaTieneMandatoActivo } = await import('../get-mandato-familia')

describe('familiaTieneMandatoActivo', () => {
  it('premisa: sin mandato, null; con él, sus últimos 4', async () => {
    r.resp = { data: null, error: null }
    expect(await familiaTieneMandatoActivo('f-1')).toBeNull()
    r.resp = {
      data: {
        iban_ultimos4: '1332',
        titular: 'Tutor Demo',
        identificador_mandato: 'X',
        fecha_firma: '2026-09-01',
        metodo_firma: 'digital',
      },
      error: null,
    }
    expect((await familiaTieneMandatoActivo('f-1'))?.ultimos4).toBe('1332')
  })

  it('con la lectura caída: no dice «sin mandato», lanza', async () => {
    r.resp = { data: null, error: { code: 'XX000', message: 'caída' } }
    const e = await familiaTieneMandatoActivo('f-1').then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e)).toBe(true)
  })
})
