import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { setMetodoPagoFamiliaCore } from '../set-metodo-pago-familia'

/**
 * F-4-4: método de pago a grano FAMILIA con la trampa del método congelado. `...Core`
 * upserta la preferencia y, si el recibo del mes está en BORRADOR, refleja el método con
 * un UPDATE directo; si está CONFIRMADO, NO lo toca (queda congelado al generar).
 */

const CENTRO = '00000000-0000-0000-0000-0000000000c0'
const FAMILIA = '00000000-0000-0000-0000-0000000000f0'
const INPUT = { familiaId: FAMILIA, anio: 2026, mes: 7, metodo: 'cheque_guarderia' as const }

interface Call {
  table: string
  op: 'insert' | 'update'
  patch: Record<string, unknown>
}

function makeClient(recibo: { id: string; estado: string } | null) {
  const calls: Call[] = []

  function selectChain(terminal: unknown) {
    const c: Record<string, unknown> = {}
    c.eq = () => c
    c.is = () => c
    c.maybeSingle = () => Promise.resolve({ data: terminal, error: null })
    return c
  }

  const fake = {
    from(table: string) {
      return {
        select: () =>
          selectChain(table === 'metodo_pago_familia' ? null : recibo), // metodo: no existente → insert
        insert: (patch: Record<string, unknown>) => {
          calls.push({ table, op: 'insert', patch })
          return Promise.resolve({ error: null })
        },
        update: (patch: Record<string, unknown>) => {
          calls.push({ table, op: 'update', patch })
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
  } as unknown as SupabaseClient<Database>

  return { fake, calls }
}

describe('setMetodoPagoFamiliaCore', () => {
  it('recibo en BORRADOR → upsert de preferencia + UPDATE del método en el recibo', async () => {
    const { fake, calls } = makeClient({ id: 'rec-1', estado: 'borrador' })

    const res = await setMetodoPagoFamiliaCore(fake, CENTRO, INPUT)

    expect(res.success).toBe(true)
    // Preferencia insertada (no existía) con el método pedido.
    expect(calls).toContainEqual(
      expect.objectContaining({ table: 'metodo_pago_familia', op: 'insert' })
    )
    // Y el recibo BORRADOR recibe el método (evita la trampa del congelado).
    const recUpdate = calls.find((c) => c.table === 'recibos' && c.op === 'update')
    expect(recUpdate?.patch.metodo).toBe('cheque_guarderia')
  })

  it('recibo CONFIRMADO → NO se toca el recibo (método congelado)', async () => {
    const { fake, calls } = makeClient({ id: 'rec-1', estado: 'pendiente_procesar' })

    const res = await setMetodoPagoFamiliaCore(fake, CENTRO, INPUT)

    expect(res.success).toBe(true)
    // La preferencia sí se guarda...
    expect(calls.some((c) => c.table === 'metodo_pago_familia')).toBe(true)
    // ...pero el recibo confirmado NO se actualiza.
    expect(calls.some((c) => c.table === 'recibos' && c.op === 'update')).toBe(false)
  })

  it('sin recibo del mes → solo upsert de preferencia', async () => {
    const { fake, calls } = makeClient(null)

    const res = await setMetodoPagoFamiliaCore(fake, CENTRO, INPUT)

    expect(res.success).toBe(true)
    expect(calls.some((c) => c.table === 'recibos' && c.op === 'update')).toBe(false)
  })
})
