import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reabrirRemesa } from '../reabrir-remesa'

/**
 * Reabrir es una sola llamada a `reabrir_remesa` (`20261227120000`) con los números que vio la
 * admin: la BD comprueba que siguen siendo esos, devuelve los recibos a pendiente y deja el fichero
 * anterior guardado. La app no escribe ninguna tabla, y cada rechazo llega con su clave.
 */

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))

const ID = '11111111-1111-4111-8111-111111111111'
const VISTO = { remesaId: ID, nRecibos: 3, totalCentimos: 30000 }

describe('reabrirRemesa', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: { n_a_pendiente: 3 }, error: null })
    from.mockReset().mockImplementation(() => {
      throw new Error('reabrir no escribe tablas: va por la función')
    })
  })

  it('llama a la función con la remesa y los números que vio, y nada más', async () => {
    expect(await reabrirRemesa(VISTO)).toEqual({ success: true, data: { nAPendiente: 3 } })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('reabrir_remesa', {
      p_remesa_id: ID,
      p_n_recibos: 3,
      p_total_centimos: 30000,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('cero recibos a pendiente es un cero; sin el dato, null, no un cero inventado', async () => {
    rpc.mockResolvedValue({ data: { n_a_pendiente: 0 }, error: null })
    expect(await reabrirRemesa(VISTO)).toEqual({ success: true, data: { nAPendiente: 0 } })
    rpc.mockResolvedValue({ data: {}, error: null })
    expect(await reabrirRemesa(VISTO)).toEqual({ success: true, data: { nAPendiente: null } })
  })

  it.each([
    [{ code: 'P0001', hint: 'nada_que_reabrir' }, 'remesas.errors.nada_que_reabrir'],
    [{ code: '40001', hint: 'remesa_cambiada' }, 'remesas.errors.remesa_cambiada'],
    [{ code: 'P0001', hint: 'no_encontrada' }, 'remesas.errors.no_encontrada'],
    [{ code: '42501', hint: null }, 'remesas.errors.no_autorizado'],
    [{ code: 'XX000', hint: null }, 'remesas.errors.reabrir_failed'],
    [{ code: 'P0001', hint: 'otro_hint' }, 'remesas.errors.reabrir_failed'],
  ])('el rechazo %o se dice como %s', async (error, clave) => {
    rpc.mockResolvedValue({ data: null, error: { ...error, message: 'x' } })
    expect(await reabrirRemesa(VISTO)).toEqual({ success: false, error: clave })
  })

  it.each([
    [{ ...VISTO, remesaId: 'x' }],
    [{ ...VISTO, nRecibos: -1 }],
    [{ ...VISTO, totalCentimos: 1.5 }],
  ])('con datos que no valen (%o), no llama a la BD', async (input) => {
    expect(await reabrirRemesa(input)).toEqual({
      success: false,
      error: 'remesas.errors.invalid',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
