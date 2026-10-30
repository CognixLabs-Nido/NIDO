// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El plazo provisional de export_log (20261210120000): el cron pasa los años de la constante y la
 * simulación tal cual, y un fallo no tumba el resto del cron.
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

const { purgarExportLog } = await import('../lib/export-log')
const { RETENCION_REGISTROS_DERECHOS_ANIOS } = await import('../types')

beforeEach(() => {
  h.llamadas = []
  h.respuesta = { data: 3, error: null }
})

describe('purgarExportLog', () => {
  it.each([true, false])('dryRun=%s: pasa el plazo y la simulación', async (dryRun) => {
    const r = await purgarExportLog({ dryRun })
    expect(h.llamadas).toEqual([
      {
        fn: 'purgar_export_log',
        args: { p_anios: RETENCION_REGISTROS_DERECHOS_ANIOS, p_simular: dryRun },
      },
    ])
    expect(r).toEqual({ dryRun, filas: 3 })
  })

  it('un fallo se devuelve como NULL, sin lanzar', async () => {
    h.respuesta = { data: null, error: { message: 'caído' } }
    await expect(purgarExportLog({ dryRun: false })).resolves.toEqual({
      dryRun: false,
      filas: null,
    })
  })
})
