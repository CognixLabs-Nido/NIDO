import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { confirmarRecibo, confirmarRecibosCore } from '../confirmar-recibo'

/**
 * F-4-4: confirmación EN LOTE. `confirmarRecibosCore` llama `confirmar_recibo` una vez por
 * id (semántica recibo-a-recibo). Cuenta confirmados/fallidos y marca `cerrado` si alguna
 * llamada devolvió `true` (la RPC ancla el cierre al confirmar el último borrador del mes).
 * PR-3: un recibo con desborde de beca pendiente (HINT `desborde_pendiente` del trigger) no es un
 * fallo: se salta y se lista aparte.
 */

const { respuestaUno } = vi.hoisted(() => ({
  respuestaUno: { data: null as boolean | null, error: null as unknown },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: async () => respuestaUno }),
}))

interface RpcOutcome {
  data: boolean | null
  error: { message: string; hint?: string } | null
}

const DESBORDE = { message: 'desborde', hint: 'desborde_pendiente' }

function makeRpcClient(outcomes: RpcOutcome[]) {
  let i = 0
  const fake = {
    rpc: (_name: string, _args: unknown) =>
      Promise.resolve(outcomes[i++] ?? { data: null, error: null }),
  } as unknown as SupabaseClient<Database>
  return fake
}

describe('confirmarRecibosCore', () => {
  it('confirma todos; el último devuelve true → cerrado=true', async () => {
    const fake = makeRpcClient([
      { data: false, error: null },
      { data: false, error: null },
      { data: true, error: null },
    ])

    const res = await confirmarRecibosCore(fake, ['a', 'b', 'c'])

    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.confirmados).toBe(3)
      expect(res.data.fallidos).toBe(0)
      expect(res.data.cerrado).toBe(true)
      expect(res.data.conDesborde).toEqual([])
    }
  })

  it('PR-3: el recibo con desborde pendiente se salta y se lista aparte, no cuenta como fallido', async () => {
    const fake = makeRpcClient([
      { data: false, error: null },
      { data: null, error: DESBORDE },
      { data: null, error: { message: 'boom' } },
    ])

    const res = await confirmarRecibosCore(fake, ['a', 'b', 'c'])

    expect(res).toEqual({
      success: true,
      data: { confirmados: 1, fallidos: 1, cerrado: false, conDesborde: ['b'] },
    })
  })

  it('PR-3: si todos tienen el desborde pendiente, no es un fallo: se listan', async () => {
    const fake = makeRpcClient([
      { data: null, error: DESBORDE },
      { data: null, error: DESBORDE },
    ])

    expect(await confirmarRecibosCore(fake, ['a', 'b'])).toEqual({
      success: true,
      data: { confirmados: 0, fallidos: 0, cerrado: false, conDesborde: ['a', 'b'] },
    })
  })

  it('un error en el lote → cuenta fallidos pero no aborta; success si alguno pasó', async () => {
    const fake = makeRpcClient([
      { data: false, error: null },
      { data: null, error: { message: 'boom' } },
      { data: false, error: null },
    ])

    const res = await confirmarRecibosCore(fake, ['a', 'b', 'c'])

    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.confirmados).toBe(2)
      expect(res.data.fallidos).toBe(1)
      expect(res.data.cerrado).toBe(false)
    }
  })

  it('todos fallan → fail(confirmar_failed)', async () => {
    const fake = makeRpcClient([
      { data: null, error: { message: 'x' } },
      { data: null, error: { message: 'y' } },
    ])

    const res = await confirmarRecibosCore(fake, ['a', 'b'])

    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recibos_panel.errors.confirmar_failed')
  })
})

describe('confirmarRecibo (uno)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('premisa: sin error confirma y dice si el mes quedó cerrado', async () => {
    respuestaUno.data = true
    respuestaUno.error = null
    expect(await confirmarRecibo(ID)).toEqual({ success: true, data: { cerrado: true } })
  })

  it('PR-3: el desborde pendiente se traduce a su aviso, no al error genérico', async () => {
    respuestaUno.data = null
    respuestaUno.error = DESBORDE
    expect(await confirmarRecibo(ID)).toEqual({
      success: false,
      error: 'recibos_panel.errors.desborde_pendiente',
    })
    respuestaUno.error = { message: 'otro' }
    expect(await confirmarRecibo(ID)).toEqual({
      success: false,
      error: 'recibos_panel.errors.confirmar_failed',
    })
  })

  it('PR-5: una beca ya descontada en otro recibo se traduce a su aviso', async () => {
    respuestaUno.data = null
    respuestaUno.error = {
      code: 'P0001',
      message: 'el recibo descuenta 1 becas y solo 0 siguen pendientes',
      hint: 'beca_ya_aplicada',
    }
    expect(await confirmarRecibo(ID)).toEqual({
      success: false,
      error: 'recibos_panel.errors.beca_ya_aplicada',
    })
  })
})
