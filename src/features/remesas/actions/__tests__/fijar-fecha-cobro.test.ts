import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { fijarFechaCobro } from '../fijar-fecha-cobro'

/**
 * La acción de la fecha de cobro (`fijar_fecha_cobro_recibos`, `20261214120000`): lo que manda es
 * la BD. La acción valida la forma, pasa la fecha o NULL, cuenta los que cambiaron y traduce cada
 * «no» de la BD a una clave que existe en los tres idiomas y dice por qué.
 */

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))

const C = '11111111-1111-4111-8111-111111111111'
const R1 = '22222222-2222-4222-8222-222222222222'
const R2 = '33333333-3333-4333-8333-333333333333'

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('fijarFechaCobro', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({
      data: [
        { recibo_id: R1, resultado: 'cambiada' },
        { recibo_id: R2, resultado: 'sin_cambio' },
      ],
      error: null,
    })
  })

  it('pasa la fecha a la BD y cuenta los que cambiaron', async () => {
    expect(
      await fijarFechaCobro({ centroId: C, reciboIds: [R1, R2], fecha: '2026-11-05' })
    ).toEqual({
      success: true,
      data: { cambiados: 1 },
    })
    expect(rpc).toHaveBeenCalledWith('fijar_fecha_cobro_recibos', {
      p_centro_id: C,
      p_recibo_ids: [R1, R2],
      p_fecha: '2026-11-05',
    })
  })

  it('sin fecha pasa NULL: quitarla', async () => {
    await fijarFechaCobro({ centroId: C, reciboIds: [R1], fecha: null })
    expect(rpc.mock.calls[0][1].p_fecha).toBeNull()
  })

  it('una fecha mal formada, que no existe, o una lista vacía no llegan a la BD', async () => {
    for (const fecha of ['', '2026-11-31', '05/11/2026', '2026-2-3']) {
      expect(await fijarFechaCobro({ centroId: C, reciboIds: [R1], fecha }), fecha).toEqual({
        success: false,
        error: 'remesas.errors.invalid',
      })
    }
    expect((await fijarFechaCobro({ centroId: C, reciboIds: [], fecha: null })).success).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('cada «no» de la BD tiene su motivo, y existe en los tres idiomas', async () => {
    const casos: Array<[{ code: string; hint?: string }, string]> = [
      [{ code: 'P0001', hint: 'fecha_cobro_en_fichero' }, 'remesas.errors.fecha_cobro_en_fichero'],
      [
        { code: 'P0001', hint: 'fecha_cobro_recibo_cerrado' },
        'remesas.errors.fecha_cobro_recibo_cerrado',
      ],
      [{ code: 'P0001', hint: 'recibo_no_sepa' }, 'remesas.errors.fecha_cobro_no_sepa'],
      [{ code: '42501' }, 'remesas.errors.no_autorizado'],
      [{ code: '22023' }, 'remesas.errors.invalid'],
      [{ code: 'XX000' }, 'remesas.errors.fecha_cobro_failed'],
    ]
    for (const [error, clave] of casos) {
      rpc.mockResolvedValueOnce({ data: null, error: { message: 'x', ...error } })
      expect(await fijarFechaCobro({ centroId: C, reciboIds: [R1], fecha: null })).toEqual({
        success: false,
        error: clave,
      })
      for (const msgs of [es, en, va]) expect(typeof hoja(msgs, clave), clave).toBe('string')
    }
  })
})
