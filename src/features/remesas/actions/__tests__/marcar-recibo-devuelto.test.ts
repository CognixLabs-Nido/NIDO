import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarReciboDevuelto } from '../marcar-recibo-devuelto'

/**
 * PR-2: «Marcar devuelto» guarda la fecha que dice el banco (no la de hoy) y los gastos en
 * céntimos. Desde `20261223120000` es una sola llamada a `marcar_recibo_devuelto`: la BD solo deja
 * pasar un recibo a devuelto por esa función, que hace los rechazos que hacía la app (fecha futura
 * o anterior al envío, gastos negativos, un recibo que no está enviado), y la app no escribe ninguna
 * tabla. Cada rechazo llega con su clave, la misma de antes.
 */

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))

const RECIBO = '22222222-2222-4222-8222-222222222222'
const base = { reciboId: RECIBO, fecha: '2026-10-20', gastos_euros: 3.5 }

describe('marcarReciboDevuelto', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
    from.mockReset().mockImplementation(() => {
      throw new Error('marcar devuelto no escribe tablas: va por la función')
    })
  })

  it('llama a la función con la fecha del banco y los gastos en céntimos, y nada más', async () => {
    expect(await marcarReciboDevuelto(base)).toEqual({ success: true, data: null })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('marcar_recibo_devuelto', {
      p_recibo_id: RECIBO,
      p_fecha: '2026-10-20',
      p_gastos_centimos: 350,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('sin gastos pasa 0, no NULL', async () => {
    await marcarReciboDevuelto({ ...base, gastos_euros: 0 })
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_gastos_centimos: 0 })
  })

  it.each([
    ['22023', 'fecha_devolucion_invalida', 'remesas.validation.fecha_devolucion_futura'],
    ['P0001', 'devolucion_antes_del_envio', 'remesas.validation.devolucion_antes_del_envio'],
    ['22023', 'gastos_invalidos', 'remesas.validation.gastos_invalidos'],
    ['P0001', 'no_devolvible', 'remesas.errors.no_devolvible'],
    ['P0002', 'no_encontrado', 'remesas.errors.no_encontrada'],
    ['22023', 'datos_no_validos', 'remesas.errors.invalid'],
    ['42501', null, 'remesas.errors.no_autorizado'],
    ['XX000', null, 'remesas.errors.devolver_failed'],
    ['P0001', 'otro_hint', 'remesas.errors.devolver_failed'],
  ])('el rechazo %s/%s se dice como %s', async (code, hint, clave) => {
    rpc.mockResolvedValue({ data: null, error: { code, hint, message: 'x' } })
    expect(await marcarReciboDevuelto(base)).toEqual({ success: false, error: clave })
  })

  it('con datos que no pasan el esquema, no llama a la BD', async () => {
    expect((await marcarReciboDevuelto({ ...base, reciboId: 'x' })).success).toBe(false)
    expect(await marcarReciboDevuelto({ ...base, gastos_euros: -1 })).toEqual({
      success: false,
      error: 'remesas.validation.gastos_invalidos',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
