// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lo fiscal al vencer (20261208120000): el cron lista las familias vencidas con el plazo más largo
 * de los dos (fiscal y mandatos); en simulación solo cuenta; en real, por cada una borra antes sus
 * documentos de Storage (mandatos y DNI) y después la BD. Si Storage falla, la BD no se toca: la
 * fila es lo único que dice dónde está el documento. Una que la BD ya no destruye no cuenta; una que
 * falla no tumba a las demás.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  vencidas: { data: null as unknown, error: null as { message: string } | null },
  storage: (_b: string): { error: { message: string } | null } => ({ error: null }),
  destruir: (_f: string): { data: unknown; error: { message: string } | null } => ({
    data: { familias: 1 },
    error: null,
  }),
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => h.errores.push(a), warn: vi.fn() },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.pasos.push(`rpc:${fn}:${JSON.stringify(args)}`)
      if (fn === 'familias_fiscal_vencidas') return h.vencidas
      return h.destruir(args.p_familia_id as string)
    },
    storage: {
      from: (b: string) => ({
        remove: async (paths: string[]) => {
          h.pasos.push(`remove:${b}:${paths.join(',')}`)
          return { data: [], ...h.storage(b) }
        },
      }),
    },
  }),
}))

const { destruirFiscal, ANIOS_FISCAL } = await import('../lib/fiscal')
const { RETENCION_FISCAL_ANIOS, RETENCION_MANDATOS_SEPA_ANIOS } = await import('../types')

const DOS = [
  { familia_id: 'f1', centro_id: 'c1', mandatos: ['c1/n1/m.pdf'], dnis: ['c1/n1/dni.pdf'] },
  { familia_id: 'f2', centro_id: 'c1', mandatos: [], dnis: [] },
]

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.vencidas = { data: DOS, error: null }
  h.storage = () => ({ error: null })
  h.destruir = () => ({ data: { familias: 1 }, error: null })
})

describe('destruirFiscal', () => {
  it('premisa: el plazo es el más largo de los dos de la tabla, 6 años', () => {
    expect(RETENCION_FISCAL_ANIOS).toBe(6)
    expect(RETENCION_MANDATOS_SEPA_ANIOS).toBe(6)
    expect(ANIOS_FISCAL).toBe(6)
  })

  it('en simulación lista y cuenta, sin tocar Storage ni destruir', async () => {
    const r = await destruirFiscal({ dryRun: true })
    expect(r).toEqual({ dryRun: true, vencidas: 2, destruidas: 0, fallidas: 0 })
    expect(h.pasos).toEqual([`rpc:familias_fiscal_vencidas:{"p_anios":${ANIOS_FISCAL}}`])
  })

  it('en real: primero los documentos de Storage, después la BD; sin documentos, solo la BD', async () => {
    const r = await destruirFiscal({ dryRun: false })
    expect(h.pasos).toEqual([
      `rpc:familias_fiscal_vencidas:{"p_anios":6}`,
      'remove:mandato-sepa:c1/n1/m.pdf',
      'remove:dni-tutores:c1/n1/dni.pdf',
      `rpc:destruir_fiscal_familia:{"p_familia_id":"f1","p_anios":6}`,
      `rpc:destruir_fiscal_familia:{"p_familia_id":"f2","p_anios":6}`,
    ])
    expect(r).toEqual({ dryRun: false, vencidas: 2, destruidas: 2, fallidas: 0 })
  })

  it('si Storage falla, la BD de esa familia no se toca y las demás siguen', async () => {
    h.storage = (b) => (b === 'dni-tutores' ? { error: { message: 'caído' } } : { error: null })
    const r = await destruirFiscal({ dryRun: false })
    expect(h.pasos).not.toContain(`rpc:destruir_fiscal_familia:{"p_familia_id":"f1","p_anios":6}`)
    expect(h.pasos).toContain(`rpc:destruir_fiscal_familia:{"p_familia_id":"f2","p_anios":6}`)
    expect(r.destruidas).toBe(1)
    expect(r.fallidas).toBe(1)
    expect(h.errores[0]).toContain('f1')
  })

  it('la que la BD ya no destruye (la retuvieron, le entró dinero) no cuenta', async () => {
    h.destruir = (f) => ({ data: f === 'f1' ? null : { familias: 1 }, error: null })
    const r = await destruirFiscal({ dryRun: false })
    expect(r.destruidas).toBe(1)
    expect(r.fallidas).toBe(0)
  })

  it('una que falla en la BD se cuenta y las demás siguen', async () => {
    h.destruir = (f) =>
      f === 'f1'
        ? { data: null, error: { message: 'boom' } }
        : { data: { familias: 1 }, error: null }
    const r = await destruirFiscal({ dryRun: false })
    expect(r.destruidas).toBe(1)
    expect(r.fallidas).toBe(1)
  })

  it('si no se puede listar, NULL y no se destruye ninguna', async () => {
    h.vencidas = { data: null, error: { message: 'caído' } }
    const r = await destruirFiscal({ dryRun: false })
    expect(r.vencidas).toBeNull()
    expect(h.pasos.some((p) => p.startsWith('rpc:destruir_fiscal_familia'))).toBe(false)
  })
})
