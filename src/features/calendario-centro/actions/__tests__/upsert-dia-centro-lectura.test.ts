import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, 2026-11-26): marcar un día del calendario. «¿Ya hay fila para ese día?» caído era «no» →
 * INSERT, que paraba el UNIQUE con un «no se pudo guardar» genérico. Ahora `lectura_fallida`, sin escribir.
 * Fixtures ficticios.
 */
const { bd } = vi.hoisted(() => ({ bd: { caida: false, escrituras: [] as string[] } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) c[m] = () => c
      c.maybeSingle = async () =>
        bd.caida
          ? { data: null, error: { code: 'XX000', message: 'caída' } }
          : { data: null, error: null }
      c.insert = () => {
        bd.escrituras.push(`insert ${tabla}`)
        return { select: () => ({ single: async () => ({ data: { id: 'd-1' }, error: null }) }) }
      }
      return c
    },
  }),
}))
const { upsertDiaCentro } = await import('../upsert-dia-centro')
const DIA = {
  centro_id: '00000000-0000-4000-8000-000000000001',
  fecha: '2026-12-08',
  tipo: 'festivo' as const,
  observaciones: null,
}

beforeEach(() => {
  bd.caida = false
  bd.escrituras = []
})

describe('upsertDiaCentro', () => {
  it('premisa: sin fila para ese día, la inserta', async () => {
    const r = await upsertDiaCentro(DIA)
    expect(r.success).toBe(true)
    expect(bd.escrituras).toEqual(['insert dias_centro'])
  })

  it('sin poder mirar si ya hay fila: lectura_fallida, y no escribe', async () => {
    bd.caida = true
    expect(await upsertDiaCentro(DIA)).toEqual({ success: false, error: 'common.lectura_fallida' })
    expect(bd.escrituras).toEqual([])
  })
})
