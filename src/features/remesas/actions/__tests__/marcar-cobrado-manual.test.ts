import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarCobradoManual } from '../marcar-cobrado-manual'

/**
 * PR-1a: «Marcar cobrado» guarda la forma, la fecha y la nota de un recibo pendiente que no es
 * SEPA. Desde `20261223120000` es una sola llamada a `marcar_cobrado_manual`: la BD solo deja cobrar
 * a mano por sus funciones, y esta hace los rechazos que hacía la app (un SEPA pendiente, un
 * devuelto, otro estado, fecha futura, nota larga). La app no escribe ninguna tabla, y cada rechazo
 * llega con su clave, la misma de antes.
 */

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))

const RECIBO = '33333333-3333-4333-8333-333333333333'
const base = { reciboId: RECIBO, forma: 'efectivo' as const, fecha: '2026-10-20', nota: '' }

describe('marcarCobradoManual', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
    from.mockReset().mockImplementation(() => {
      throw new Error('marcar cobrado no escribe tablas: va por la función')
    })
  })

  it('llama a la función con la forma, la fecha y la nota, y nada más', async () => {
    expect(await marcarCobradoManual({ ...base, nota: 'Pagó en secretaría' })).toEqual({
      success: true,
      data: null,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('marcar_cobrado_manual', {
      p_recibo_id: RECIBO,
      p_forma: 'efectivo',
      p_fecha: '2026-10-20',
      p_nota: 'Pagó en secretaría',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('sin nota pasa una vacía, que la función guarda como NULL', async () => {
    await marcarCobradoManual(base)
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_nota: '' })
  })

  it.each([
    ['22023', 'fecha_cobro_futura', 'remesas.validation.fecha_cobro_futura'],
    ['22023', 'nota_cobro_larga', 'remesas.validation.nota_cobro_larga'],
    ['P0001', 'sepa_por_remesa', 'remesas.errors.sepa_por_remesa'],
    ['P0001', 'devolucion_por_resolver', 'remesas.errors.devolucion_por_resolver'],
    ['P0001', 'no_cobrable_manual', 'remesas.errors.no_cobrable_manual'],
    ['P0002', 'no_encontrado', 'remesas.errors.no_encontrada'],
    ['22023', 'forma_no_valida', 'remesas.errors.invalid'],
    ['22023', 'datos_no_validos', 'remesas.errors.invalid'],
    ['42501', null, 'remesas.errors.no_autorizado'],
    ['XX000', null, 'remesas.errors.cobrar_manual_failed'],
    ['P0001', 'otro_hint', 'remesas.errors.cobrar_manual_failed'],
  ])('el rechazo %s/%s se dice como %s', async (code, hint, clave) => {
    rpc.mockResolvedValue({ data: null, error: { code, hint, message: 'x' } })
    expect(await marcarCobradoManual(base)).toEqual({ success: false, error: clave })
  })

  it('el cheque no entra aquí: el esquema lo rechaza sin llamar a la BD', async () => {
    const r = await marcarCobradoManual({ ...base, forma: 'cheque_guarderia' as never })
    expect(r.success).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
})
