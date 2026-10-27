// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El plazo provisional del registro de lecturas de la ficha médica (20261128120000): el cron pasa
 * los meses de la constante y la simulación tal cual, y un fallo no tumba el resto del cron.
 */

const h = vi.hoisted(() => ({
  llamadas: [] as Array<{ fn: string; args: unknown }>,
  respuesta: { data: 3 as number | null, error: null as { message: string } | null },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      h.llamadas.push({ fn, args })
      return h.respuesta
    },
  }),
}))

const { purgarLecturasFichaMedica } = await import('../lib/lecturas-ficha-medica')
const { RETENCION_LECTURAS_FICHA_MEDICA_MESES } = await import('../types')

beforeEach(() => {
  h.llamadas = []
  h.respuesta = { data: 3, error: null }
})

describe('purgarLecturasFichaMedica', () => {
  it.each([true, false])('dryRun=%s: pasa el plazo y la simulación', async (dryRun) => {
    const r = await purgarLecturasFichaMedica({ dryRun })
    expect(h.llamadas).toEqual([
      {
        fn: 'purgar_lecturas_ficha_medica',
        args: { p_meses: RETENCION_LECTURAS_FICHA_MEDICA_MESES, p_simular: dryRun },
      },
    ])
    expect(r).toEqual({ dryRun, lecturas: 3 })
  })

  it('un fallo se devuelve como NULL, sin lanzar', async () => {
    h.respuesta = { data: null, error: { message: 'caído' } }
    await expect(purgarLecturasFichaMedica({ dryRun: false })).resolves.toEqual({
      dryRun: false,
      lecturas: null,
    })
  })
})
