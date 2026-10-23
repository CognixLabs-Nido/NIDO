import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { cobrarConCheque } from '../cobrar-con-cheque'

/**
 * PR-1b: «Marcar cobrado» con cheque guardería / ticket restaurant llama a
 * `cobrar_recibo_con_cheque` con el importe en céntimos, la nota vacía como NULL y el método de la
 * diferencia; no cobra una fecha futura; y traduce el HINT de la BD a una clave que existe en los
 * tres idiomas.
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
const base = { reciboId: RECIBO, importe_euros: 100, fecha: '2026-10-20' }

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('cobrarConCheque', () => {
  beforeEach(() => {
    estado.recibo = { id: 'r1', centro_id: 'c1' }
    estado.respuesta = { data: null, error: null }
    rpc.mockReset()
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: cheque que cubre el recibo → la RPC con céntimos, nota NULL y sin método', async () => {
    expect(await cobrarConCheque(base)).toEqual({ success: true, data: { diferenciaId: null } })
    expect(rpc).toHaveBeenCalledWith('cobrar_recibo_con_cheque', {
      p_recibo_id: 'r1',
      p_importe_centimos: 10000,
      p_fecha: '2026-10-20',
      p_nota: null,
      p_metodo_diferencia: null,
    })
  })

  it('cheque menor: pasa el método de la diferencia y devuelve el recibo nuevo', async () => {
    estado.respuesta = { data: 'dif1', error: null }
    const r = await cobrarConCheque({
      ...base,
      importe_euros: 99.99,
      nota: '  Cheque de la empresa  ',
      metodoDiferencia: 'sepa',
    })
    expect(r).toEqual({ success: true, data: { diferenciaId: 'dif1' } })
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_importe_centimos: 9999,
      p_nota: 'Cheque de la empresa',
      p_metodo_diferencia: 'sepa',
    })
  })

  it('fecha futura, importe ≤ 0 o un método que no es de la diferencia: no llama a la BD', async () => {
    expect(await cobrarConCheque({ ...base, fecha: '2026-10-23' })).toEqual({
      success: false,
      error: 'remesas.validation.fecha_cobro_futura',
    })
    expect((await cobrarConCheque({ ...base, importe_euros: 0 })).success).toBe(false)
    expect(
      (
        await cobrarConCheque({
          ...base,
          metodoDiferencia: 'cheque_guarderia' as unknown as 'sepa',
        })
      ).success
    ).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('quien no es Dirección del centro del recibo, no', async () => {
    admin.mockResolvedValue(null)
    expect(await cobrarConCheque(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un recibo que no existe (o no se ve)', async () => {
    estado.recibo = null
    expect(await cobrarConCheque(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_encontrada',
    })
  })

  const HINTS: Array<[string, string]> = [
    ['no_encontrado', 'remesas.errors.no_encontrada'],
    ['sepa_por_remesa', 'remesas.errors.sepa_por_remesa'],
    ['no_cobrable_manual', 'remesas.errors.no_cobrable_manual'],
    ['cheque_supera_recibo', 'remesas.errors.cheque_supera_recibo'],
    ['sin_mandato', 'remesas.errors.sin_mandato_diferencia'],
    ['falta_metodo_diferencia', 'remesas.validation.falta_metodo_diferencia'],
    ['importe_cheque_invalido', 'remesas.validation.importe_cheque_invalido'],
    ['fecha_cobro_invalida', 'remesas.validation.fecha_cobro_invalida'],
  ]

  it.each(HINTS)('HINT %s → %s, que existe en es, en y va', async (hint, clave) => {
    estado.respuesta = { data: null, error: { code: 'P0001', hint, message: 'x' } }
    expect(await cobrarConCheque(base)).toEqual({ success: false, error: clave })
    for (const msgs of [es, en, va]) {
      expect(typeof hoja(msgs as Record<string, unknown>, clave)).toBe('string')
    }
  })

  it('42501 → no autorizado; un error sin HINT conocido → el genérico', async () => {
    estado.respuesta = { data: null, error: { code: '42501', message: 'x' } }
    expect((await cobrarConCheque(base)).success).toBe(false)
    expect(await cobrarConCheque(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    estado.respuesta = { data: null, error: { code: 'XX000', hint: 'otro', message: 'x' } }
    expect(await cobrarConCheque(base)).toEqual({
      success: false,
      error: 'remesas.errors.cobrar_manual_failed',
    })
  })
})
