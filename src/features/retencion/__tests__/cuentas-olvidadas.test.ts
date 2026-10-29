// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La cuenta de quien ya no tiene nada (20261208120000): primero la BD borra las filas de usuarios
 * que nada nombra; después se borran por la Admin API las cuentas de Auth que se quedaron sin fila,
 * también las de una pasada anterior. En simulación solo se cuenta y no se borra nada de Auth.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  olvidadas: { data: null as unknown, error: null as { message: string } | null },
  huerfanas: { data: [] as unknown, error: null as { message: string } | null },
  borrar: (_id: string): { error: { message: string } | null } => ({ error: null }),
  errores: [] as unknown[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => h.errores.push(a), warn: vi.fn() },
}))
vi.mock('@/features/olvido/actions/purgar-vencidos', () => ({ purgarUno: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      h.pasos.push(`rpc:${fn}:${JSON.stringify(args ?? {})}`)
      if (fn === 'destruir_cuentas_olvidadas') return h.olvidadas
      return h.huerfanas
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          h.pasos.push(`deleteUser:${id}`)
          return { data: null, ...h.borrar(id) }
        },
      },
    },
  }),
}))

const { borrarCuentasOlvidadas } = await import('../lib/cuentas')

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.olvidadas = { data: { borradas: ['u1', 'u2'], esperan: 1 }, error: null }
  h.huerfanas = { data: ['u1', 'u2', 'u-vieja'], error: null }
  h.borrar = () => ({ error: null })
})

describe('borrarCuentasOlvidadas', () => {
  it('en simulación cuenta las candidatas y las de Auth, sin borrar nada', async () => {
    h.olvidadas = { data: { candidatas: 4 }, error: null }
    const r = await borrarCuentasOlvidadas({ dryRun: true })
    expect(h.pasos).toEqual([
      'rpc:destruir_cuentas_olvidadas:{"p_simular":true}',
      'rpc:cuentas_auth_huerfanas:{}',
    ])
    expect(r).toEqual({
      dryRun: true,
      candidatas: 4,
      borradas: 0,
      esperan: 0,
      auth: { pendientes: 3, borradas: 0, fallidas: 0 },
    })
  })

  it('en real: primero la BD, después Auth, también la de una pasada anterior', async () => {
    const r = await borrarCuentasOlvidadas({ dryRun: false })
    expect(h.pasos).toEqual([
      'rpc:destruir_cuentas_olvidadas:{"p_simular":false}',
      'rpc:cuentas_auth_huerfanas:{}',
      'deleteUser:u1',
      'deleteUser:u2',
      'deleteUser:u-vieja',
    ])
    expect(r).toEqual({
      dryRun: false,
      candidatas: 3,
      borradas: 2,
      esperan: 1,
      auth: { pendientes: 3, borradas: 3, fallidas: 0 },
    })
  })

  it('una cuenta de Auth que falla se cuenta y las demás siguen', async () => {
    h.borrar = (id) => (id === 'u1' ? { error: { message: 'caído' } } : { error: null })
    const r = await borrarCuentasOlvidadas({ dryRun: false })
    expect(r.auth).toEqual({ pendientes: 3, borradas: 2, fallidas: 1 })
    expect(h.errores[0]).toContain('u1')
  })

  it('si la BD falla, NULL; las de Auth de antes se reintentan igual', async () => {
    h.olvidadas = { data: null, error: { message: 'caído' } }
    h.huerfanas = { data: ['u-vieja'], error: null }
    const r = await borrarCuentasOlvidadas({ dryRun: false })
    expect(r.candidatas).toBeNull()
    expect(r.borradas).toBe(0)
    expect(h.pasos).toContain('deleteUser:u-vieja')
  })

  it('si no se puede listar Auth, NULL y no se borra ninguna', async () => {
    h.huerfanas = { data: null, error: { message: 'caído' } }
    const r = await borrarCuentasOlvidadas({ dryRun: false })
    expect(r.auth.pendientes).toBeNull()
    expect(h.pasos.some((p) => p.startsWith('deleteUser'))).toBe(false)
  })
})
