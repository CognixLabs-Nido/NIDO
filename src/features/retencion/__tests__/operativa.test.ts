// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El plazo provisional de la operativa (20261203120000): el cron pasa los años de la constante y
 * la simulación tal cual, lee el recuento por tabla, y un fallo o una respuesta con otra forma no
 * tumba el resto del cron.
 */

const h = vi.hoisted(() => ({
  llamadas: [] as Array<{ fn: string; args: unknown }>,
  respuesta: { data: null as unknown, error: null as { message: string } | null },
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => h.errores.push(a), warn: vi.fn() },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      h.llamadas.push({ fn, args })
      return h.respuesta
    },
  }),
}))

const { purgarOperativa } = await import('../lib/operativa')
const { RETENCION_OPERATIVA_ANIOS, TABLAS_OPERATIVA } = await import('../types')

// La forma que devuelve la función: un número por tabla y las copias huérfanas.
const respuesta = Object.fromEntries(
  [...TABLAS_OPERATIVA, 'copias_huerfanas'].map((k, i) => [k, i + 1])
)

beforeEach(() => {
  h.llamadas = []
  h.errores = []
  h.respuesta = { data: { ...respuesta }, error: null }
})

describe('purgarOperativa', () => {
  it.each([true, false])('dryRun=%s: pasa el plazo y la simulación', async (dryRun) => {
    const r = await purgarOperativa({ dryRun })
    expect(h.llamadas).toEqual([
      {
        fn: 'purgar_operativa_vencida',
        args: { p_anios: RETENCION_OPERATIVA_ANIOS, p_simular: dryRun },
      },
    ])
    expect(r).toEqual({ dryRun, filas: respuesta })
    expect(h.errores).toEqual([])
  })

  it('un fallo se devuelve como NULL, sin lanzar', async () => {
    h.respuesta = { data: null, error: { message: 'caído' } }
    await expect(purgarOperativa({ dryRun: false })).resolves.toEqual({
      dryRun: false,
      filas: null,
    })
    expect(h.errores).toHaveLength(1)
  })

  it('una respuesta a la que le falta una tabla es NULL y se registra', async () => {
    const sinMensajes: Record<string, unknown> = { ...respuesta }
    delete sinMensajes.mensajes
    h.respuesta = { data: sinMensajes, error: null }
    await expect(purgarOperativa({ dryRun: true })).resolves.toEqual({
      dryRun: true,
      filas: null,
    })
    expect(h.errores).toHaveLength(1)
  })

  it('las claves que sobran no pasan', async () => {
    h.respuesta = { data: { ...respuesta, otra: 9 }, error: null }
    const r = await purgarOperativa({ dryRun: true })
    expect(r.filas).toEqual(respuesta)
  })
})
