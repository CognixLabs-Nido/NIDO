import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarRemesaEnviada } from '../marcar-remesa-enviada'

/**
 * Marcar enviada es una sola llamada a `marcar_remesa_enviada` (R-4, `20261221120000`): la BD solo
 * deja pasar una remesa a enviada por esa función, que exige el fichero y pasa sus recibos en la
 * misma transacción. La app no escribe ninguna tabla, y cada rechazo llega con su clave, que dice
 * qué hacer.
 */

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))

const ID = '11111111-1111-4111-8111-111111111111'

describe('marcarRemesaEnviada', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: 2, error: null })
    from.mockReset().mockImplementation(() => {
      throw new Error('marcar enviada no escribe tablas: va por la función')
    })
  })

  it('llama a la función con la remesa, y nada más', async () => {
    expect(await marcarRemesaEnviada({ remesaId: ID })).toEqual({ success: true, data: null })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('marcar_remesa_enviada', { p_remesa_id: ID })
    expect(from).not.toHaveBeenCalled()
  })

  it.each([
    [{ code: 'P0001', hint: 'sin_fichero' }, 'remesas.errors.sin_fichero'],
    [{ code: 'P0001', hint: 'fichero_no_coincide' }, 'remesas.errors.fichero_no_coincide'],
    [{ code: 'P0001', hint: 'ya_enviada' }, 'remesas.errors.ya_enviada'],
    [{ code: 'P0001', hint: 'no_encontrada' }, 'remesas.errors.no_encontrada'],
    [{ code: '42501', hint: null }, 'remesas.errors.no_autorizado'],
    [{ code: 'XX000', hint: null }, 'remesas.errors.enviar_failed'],
    [{ code: 'P0001', hint: 'otro_hint' }, 'remesas.errors.enviar_failed'],
  ])('el rechazo %o se dice como %s', async (error, clave) => {
    rpc.mockResolvedValue({ data: null, error: { ...error, message: 'x' } })
    expect(await marcarRemesaEnviada({ remesaId: ID })).toEqual({ success: false, error: clave })
  })

  it('con un id que no es un uuid, no llama a la BD', async () => {
    expect(await marcarRemesaEnviada({ remesaId: 'x' })).toEqual({
      success: false,
      error: 'remesas.errors.invalid',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
