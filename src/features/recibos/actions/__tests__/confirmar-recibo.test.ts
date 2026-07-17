import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { confirmarRecibosCore } from '../confirmar-recibo'

/**
 * F-4-4: confirmación EN LOTE. `confirmarRecibosCore` llama `confirmar_recibo` una vez por
 * id (semántica recibo-a-recibo). Cuenta confirmados/fallidos y marca `cerrado` si alguna
 * llamada devolvió `true` (la RPC ancla el cierre al confirmar el último borrador del mes).
 */

interface RpcOutcome {
  data: boolean | null
  error: { message: string } | null
}

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
    }
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
