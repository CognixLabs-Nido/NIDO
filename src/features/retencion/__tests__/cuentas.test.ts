// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La cuenta del tutor al vencer (20261207120000): el cron lista las cuentas vencidas con los años
 * de la constante; en simulación solo cuenta (también los consentimientos de la cuenta, simulados);
 * en real, por cada una abre la petición por plazo y la purga con la purga del olvido (`purgarUno`),
 * nunca con la que avisa por correo. Una que la BD ya no abre no se purga; una que falla no tumba a
 * las demás.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  vencidas: { data: null as unknown, error: null as { message: string } | null },
  abrir: (_u: string): { data: unknown; error: { message: string } | null } => ({
    data: 'sol-1',
    error: null,
  }),
  consentimientos: { data: 0 as unknown, error: null as { message: string } | null },
  purgar: (_p: { solicitud_id: string }): void => undefined,
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
      if (fn === 'cuentas_vencidas') return h.vencidas
      if (fn === 'destruir_consentimientos_cuenta') return h.consentimientos
      return h.abrir(args.p_usuario_id as string)
    },
  }),
}))
vi.mock('@/features/olvido/actions/purgar-vencidos', () => ({
  purgarUno: async (
    _s: unknown,
    p: { solicitud_id: string; sujeto_tipo: string; sujeto_id: string; centro_id: string }
  ) => {
    h.pasos.push(`purgarUno:${p.solicitud_id}:${p.sujeto_tipo}:${p.sujeto_id}:${p.centro_id}`)
    h.purgar(p)
  },
  purgarYAvisar: async () => {
    h.pasos.push('purgarYAvisar')
  },
}))

const { purgarCuentas } = await import('../lib/cuentas')
const { RETENCION_CUENTA_TUTOR_ANIOS } = await import('../types')

const DOS = [
  { usuario_id: 'u1', centro_id: 'c1', solicitud_id: null },
  { usuario_id: 'u2', centro_id: 'c1', solicitud_id: 'sol-viejo' },
]

beforeEach(() => {
  h.pasos = []
  h.errores = []
  h.vencidas = { data: DOS, error: null }
  h.abrir = (u) => ({ data: `sol-${u}`, error: null })
  h.consentimientos = { data: 0, error: null }
  h.purgar = () => undefined
})

describe('purgarCuentas', () => {
  it('premisa: el plazo es el de la tabla, 5 años', () => {
    expect(RETENCION_CUENTA_TUTOR_ANIOS).toBe(5)
  })

  it('en simulación lista, cuenta y simula los consentimientos de la cuenta', async () => {
    h.consentimientos = { data: 3, error: null }
    const r = await purgarCuentas({ dryRun: true })
    expect(r).toEqual({
      dryRun: true,
      vencidas: 2,
      purgadas: 0,
      fallidas: 0,
      consentimientosCuenta: 3,
    })
    expect(h.pasos).toEqual([
      `rpc:cuentas_vencidas:{"p_anios":${RETENCION_CUENTA_TUTOR_ANIOS}}`,
      `rpc:destruir_consentimientos_cuenta:{"p_anios":5,"p_simular":true}`,
    ])
  })

  it('en real: abre la petición por plazo y la purga con purgarUno, sin correo', async () => {
    const r = await purgarCuentas({ dryRun: false })
    expect(h.pasos).toEqual([
      `rpc:cuentas_vencidas:{"p_anios":5}`,
      `rpc:abrir_purga_cuenta:{"p_usuario_id":"u1","p_centro_id":"c1","p_anios":5}`,
      'purgarUno:sol-u1:usuario:u1:c1',
      `rpc:abrir_purga_cuenta:{"p_usuario_id":"u2","p_centro_id":"c1","p_anios":5}`,
      'purgarUno:sol-u2:usuario:u2:c1',
      `rpc:destruir_consentimientos_cuenta:{"p_anios":5,"p_simular":false}`,
    ])
    expect(h.pasos).not.toContain('purgarYAvisar')
    expect(r).toEqual({
      dryRun: false,
      vencidas: 2,
      purgadas: 2,
      fallidas: 0,
      consentimientosCuenta: 0,
    })
  })

  it('la que la BD ya no abre (le dieron un rol, la retuvieron) no se purga ni cuenta', async () => {
    h.abrir = (u) => ({ data: u === 'u1' ? null : `sol-${u}`, error: null })
    const r = await purgarCuentas({ dryRun: false })
    expect(h.pasos).not.toContain('purgarUno:sol-u1:usuario:u1:c1')
    expect(r.purgadas).toBe(1)
    expect(r.fallidas).toBe(0)
  })

  it('una que falla al purgar se cuenta y las demás siguen', async () => {
    h.purgar = (p) => {
      if (p.solicitud_id === 'sol-u1') throw new Error('auth caída')
    }
    const r = await purgarCuentas({ dryRun: false })
    expect(r.purgadas).toBe(1)
    expect(r.fallidas).toBe(1)
    expect(h.errores[0]).toContain('u1')
  })

  it('una que falla al abrir se cuenta y las demás siguen', async () => {
    h.abrir = (u) =>
      u === 'u1' ? { data: null, error: { message: 'boom' } } : { data: `sol-${u}`, error: null }
    const r = await purgarCuentas({ dryRun: false })
    expect(r.purgadas).toBe(1)
    expect(r.fallidas).toBe(1)
  })

  it('si no se puede listar, NULL y no se purga ninguna', async () => {
    h.vencidas = { data: null, error: { message: 'caído' } }
    const r = await purgarCuentas({ dryRun: false })
    expect(r.vencidas).toBeNull()
    expect(r.purgadas).toBe(0)
    expect(h.pasos.some((p) => p.startsWith('rpc:abrir_purga_cuenta'))).toBe(false)
  })

  it('un fallo en los consentimientos de la cuenta da NULL, no un cero', async () => {
    h.consentimientos = { data: null, error: { message: 'caído' } }
    const r = await purgarCuentas({ dryRun: false })
    expect(r.consentimientosCuenta).toBeNull()
    expect(r.purgadas).toBe(2)
  })
})
