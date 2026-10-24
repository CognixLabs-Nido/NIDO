import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { resolverDevolucion } from '../resolver-devolucion'

/**
 * PR-2: «Resolver devolución» llama a `resolver_devolucion` con la salida; el banco (y, desde el
 * PR-14, el siguiente recibo) no lleva fecha ni nota; efectivo y transferencia llevan su fecha (nunca futura) y la nota vacía como NULL; y el
 * HINT de la BD se traduce a una clave que existe en los tres idiomas. Que sea UNA sola salida lo
 * asegura la BD (test RLS `recibos-devolucion-una-salida`).
 */

const { estado, rpc, admin } = vi.hoisted(() => ({
  estado: {
    recibo: { id: 'r1', centro_id: 'c1' } as Record<string, unknown> | null,
    respuesta: { data: null as unknown, error: null as unknown },
  },
  rpc: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/agenda-diaria/lib/fecha', () => ({ hoyMadrid: () => '2026-10-22' }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: estado.recibo }) }) }),
      }),
    }),
    rpc: async (nombre: string, args: unknown) => {
      rpc(nombre, args)
      return estado.respuesta
    },
  }),
}))

const RECIBO = '22222222-2222-4222-8222-222222222222'

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('resolverDevolucion', () => {
  beforeEach(() => {
    estado.recibo = { id: 'r1', centro_id: 'c1' }
    estado.respuesta = { data: null, error: null }
    rpc.mockReset()
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: banco → la RPC sin fecha ni nota, y devuelve el re-giro', async () => {
    estado.respuesta = { data: 'regiro1', error: null }
    expect(
      await resolverDevolucion({
        reciboId: RECIBO,
        salida: 'banco',
        fecha: '2026-10-20',
        nota: 'x',
      })
    ).toEqual({ success: true, data: { reciboId: 'regiro1' } })
    expect(rpc).toHaveBeenCalledWith('resolver_devolucion', {
      p_recibo_id: 'r1',
      p_salida: 'banco',
      p_fecha: null,
      p_nota: null,
    })
  })

  it('efectivo → con su fecha y la nota recortada; vacía como NULL', async () => {
    expect(
      await resolverDevolucion({
        reciboId: RECIBO,
        salida: 'efectivo',
        fecha: '2026-10-20',
        nota: '  Pagó en secretaría  ',
      })
    ).toEqual({ success: true, data: { reciboId: null } })
    expect(rpc.mock.calls[0]![1]).toEqual({
      p_recibo_id: 'r1',
      p_salida: 'efectivo',
      p_fecha: '2026-10-20',
      p_nota: 'Pagó en secretaría',
    })
    await resolverDevolucion({
      reciboId: RECIBO,
      salida: 'transferencia',
      fecha: '2026-10-20',
      nota: '   ',
    })
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_salida: 'transferencia', p_nota: null })
  })

  it('PR-14: siguiente recibo → la RPC sin fecha ni nota, y devuelve el recibo al que se lleva', async () => {
    estado.respuesta = { data: 'noviembre1', error: null }
    expect(
      await resolverDevolucion({
        reciboId: RECIBO,
        salida: 'siguiente_recibo',
        fecha: '2026-10-20',
        nota: 'x',
      })
    ).toEqual({ success: true, data: { reciboId: 'noviembre1' } })
    expect(rpc).toHaveBeenCalledWith('resolver_devolucion', {
      p_recibo_id: 'r1',
      p_salida: 'siguiente_recibo',
      p_fecha: null,
      p_nota: null,
    })
  })

  it('un cobro sin fecha o con fecha futura, o una salida que no existe: no llama a la BD', async () => {
    expect((await resolverDevolucion({ reciboId: RECIBO, salida: 'efectivo' })).success).toBe(false)
    expect(
      await resolverDevolucion({ reciboId: RECIBO, salida: 'transferencia', fecha: '2026-10-23' })
    ).toEqual({ success: false, error: 'remesas.validation.fecha_cobro_futura' })
    expect(
      (
        await resolverDevolucion({
          reciboId: RECIBO,
          salida: 'cheque_guarderia' as unknown as 'banco',
          fecha: '2026-10-20',
        })
      ).success
    ).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('quien no es Dirección del centro del recibo, no', async () => {
    admin.mockResolvedValue(null)
    expect(await resolverDevolucion({ reciboId: RECIBO, salida: 'banco' })).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un recibo que no existe (o no se ve)', async () => {
    estado.recibo = null
    expect(await resolverDevolucion({ reciboId: RECIBO, salida: 'banco' })).toEqual({
      success: false,
      error: 'remesas.errors.no_encontrada',
    })
  })

  const HINTS: Array<[string, string]> = [
    ['no_encontrado', 'remesas.errors.no_encontrada'],
    ['devolucion_ya_resuelta', 'remesas.errors.devolucion_ya_resuelta'],
    ['no_devuelto', 'remesas.errors.no_devuelto'],
    ['sin_mandato', 'remesas.errors.sin_mandato_devolucion'],
    ['salida_invalida', 'remesas.errors.invalid'],
    ['fecha_cobro_invalida', 'remesas.validation.fecha_cobro_devolucion'],
    ['sin_recibo_siguiente', 'remesas.errors.sin_recibo_siguiente'],
  ]

  it.each(HINTS)('HINT %s → %s, que existe en es, en y va', async (hint, clave) => {
    estado.respuesta = { data: null, error: { code: 'P0001', hint, message: 'x' } }
    expect(await resolverDevolucion({ reciboId: RECIBO, salida: 'banco' })).toEqual({
      success: false,
      error: clave,
    })
    for (const msgs of [es, en, va]) {
      expect(typeof hoja(msgs as Record<string, unknown>, clave)).toBe('string')
    }
  })

  it('42501 → no autorizado; un error sin HINT conocido → el genérico', async () => {
    estado.respuesta = { data: null, error: { code: '42501', message: 'x' } }
    expect(await resolverDevolucion({ reciboId: RECIBO, salida: 'banco' })).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    estado.respuesta = { data: null, error: { code: 'XX000', hint: 'otro', message: 'x' } }
    expect(await resolverDevolucion({ reciboId: RECIBO, salida: 'banco' })).toEqual({
      success: false,
      error: 'remesas.errors.resolver_failed',
    })
  })
})
