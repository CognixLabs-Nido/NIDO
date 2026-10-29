// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Las firmas al vencer (20261207120000): el cron lista los niños purgados con las firmas vencidas
 * con los años de la constante; en simulación solo cuenta; en real, destruye uno a uno y suma lo
 * destruido por tabla. Un niño que falla no tumba a los demás; el que la BD ya no destruye (lo
 * retuvieron entre medias) no es un fallo.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  vencidos: { data: null as unknown, error: null as { message: string } | null },
  destruir: (_nino: string): { data: unknown; error: { message: string } | null } => ({
    data: null,
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
      if (fn === 'firmas_vencidas') return h.vencidos
      return h.destruir(args.p_nino_id as string)
    },
  }),
}))

const { destruirFirmas, leerRecuento } = await import('../lib/firmas')
const { RETENCION_FIRMAS_ANIOS } = await import('../types')

const DOS = [
  { nino_id: 'n1', centro_id: 'c1' },
  { nino_id: 'n2', centro_id: 'c1' },
]
const RECUENTO = { firmas: 2, acuses_alta: 1, eventos: 0, accesos_nino: 1 }

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.vencidos = { data: DOS, error: null }
  h.destruir = () => ({ data: RECUENTO, error: null })
})

describe('destruirFirmas', () => {
  it('premisa: el plazo es el de la tabla, 5 años', () => {
    expect(RETENCION_FIRMAS_ANIOS).toBe(5)
  })

  it('en simulación lista con los años de la constante y solo cuenta', async () => {
    const r = await destruirFirmas({ dryRun: true })
    expect(r).toEqual({ dryRun: true, vencidos: 2, destruidas: {}, fallidos: 0 })
    expect(h.pasos).toEqual([`rpc:firmas_vencidas:{"p_anios":${RETENCION_FIRMAS_ANIOS}}`])
  })

  it('en real destruye uno a uno y suma por tabla', async () => {
    const r = await destruirFirmas({ dryRun: false })
    expect(h.pasos).toEqual([
      `rpc:firmas_vencidas:{"p_anios":5}`,
      `rpc:destruir_firmas_nino:{"p_nino_id":"n1","p_anios":5}`,
      `rpc:destruir_firmas_nino:{"p_nino_id":"n2","p_anios":5}`,
    ])
    expect(r).toEqual({
      dryRun: false,
      vencidos: 2,
      destruidas: { firmas: 4, acuses_alta: 2, eventos: 0, accesos_nino: 2 },
      fallidos: 0,
    })
  })

  it('un niño que falla se cuenta y los demás siguen', async () => {
    h.destruir = (nino) =>
      nino === 'n1' ? { data: null, error: { message: 'boom' } } : { data: RECUENTO, error: null }
    const r = await destruirFirmas({ dryRun: false })
    expect(r.fallidos).toBe(1)
    expect(r.destruidas.firmas).toBe(2)
    expect(h.errores).toHaveLength(1)
    expect(h.errores[0]).toContain('n1')
  })

  it('el que la BD ya no destruye (NULL: lo retuvieron) no es un fallo ni suma', async () => {
    h.destruir = (nino) => ({ data: nino === 'n2' ? null : RECUENTO, error: null })
    const r = await destruirFirmas({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: 2, destruidas: RECUENTO, fallidos: 0 })
    expect(h.errores).toHaveLength(0)
  })

  it('si no se puede listar, NULL y no se toca nada', async () => {
    h.vencidos = { data: null, error: { message: 'caído' } }
    const r = await destruirFirmas({ dryRun: false })
    expect(r).toEqual({ dryRun: false, vencidos: null, destruidas: {}, fallidos: 0 })
    expect(h.pasos).toHaveLength(1)
    expect(h.errores).toHaveLength(1)
  })

  it('una respuesta con otra forma tampoco se toma por una lista', async () => {
    h.vencidos = { data: { nino_id: 'n1' }, error: null }
    const r = await destruirFirmas({ dryRun: false })
    expect(r.vencidos).toBeNull()
    expect(h.pasos).toHaveLength(1)
  })
})

describe('leerRecuento', () => {
  it('se queda con los números y descarta lo demás', () => {
    expect(leerRecuento({ firmas: 3, raro: 'x' })).toEqual({ firmas: 3 })
    expect(leerRecuento(null)).toEqual({})
    expect(leerRecuento([1, 2])).toEqual({})
    expect(leerRecuento('firmas')).toEqual({})
  })
})
