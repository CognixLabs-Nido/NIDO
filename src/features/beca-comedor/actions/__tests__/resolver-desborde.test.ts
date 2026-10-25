import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { resolverDesborde } from '../resolver-desborde'

/**
 * PR-1c: «Resolver» elige el exceso de ese recibo POR SU ORIGEN (un recibo puede tener el de su beca
 * y el sobrante de su cheque), y el del cheque lo resuelve la BD entera (`resolver_sobrante_cheque`)
 * con la vía, sin pasar por el reparto de la beca. Una fila sin origen (antes de la migración) es de
 * beca. El HINT de la BD se traduce a una clave que existe en los tres idiomas. Lo que hace la
 * función contra la BD lo prueba `cheque-sobrante.rls.test.ts`.
 */

const { estado, rpc, admin } = vi.hoisted(() => ({
  estado: {
    filas: [] as Array<Record<string, unknown>>,
    respuesta: { data: null as unknown, error: null as unknown },
  },
  rpc: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    // Solo la lectura de los excesos del recibo: la rama de la beca no se recorre aquí.
    from: (tabla: string) => {
      if (tabla !== 'beca_comedor_desborde') throw new Error(`tabla inesperada: ${tabla}`)
      return { select: () => ({ eq: async () => ({ data: estado.filas }) }) }
    },
    rpc: async (nombre: string, args: unknown) => {
      rpc(nombre, args)
      return estado.respuesta
    },
  }),
}))

const RECIBO = '22222222-2222-4222-8222-222222222222'
const ERR = 'admin.cuotas.beca_comedor.desborde.errors'

function fila(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'd1',
    centro_id: 'c1',
    recibo_id: RECIBO,
    familia_id: 'f1',
    anio: 2026,
    mes: 1,
    exceso_centimos: 1000,
    estado: 'pendiente',
    origen: 'cheque',
    ...over,
  }
}

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

describe('resolverDesborde — el sobrante de un cheque (PR-1c)', () => {
  beforeEach(() => {
    estado.filas = [fila({})]
    estado.respuesta = { data: 'x', error: null }
    rpc.mockReset()
    admin.mockReset().mockResolvedValue('u1')
  })

  it('el del cheque lo resuelve la BD con la vía, también al lado de una beca pendiente', async () => {
    estado.filas = [fila({ id: 'beca', origen: 'beca' }), fila({})]
    for (const via of ['diferir', 'transferencia'] as const) {
      rpc.mockClear()
      expect(await resolverDesborde({ recibo_id: RECIBO, via, origen: 'cheque' })).toEqual({
        success: true,
        data: { via, n: 1 },
      })
      expect(rpc).toHaveBeenCalledWith('resolver_sobrante_cheque', {
        p_recibo_id: RECIBO,
        p_via: via,
      })
    }
  })

  it('cada origen busca el suyo: sin fila de ese origen no hay nada que resolver', async () => {
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'beca' })).toEqual({
      success: false,
      error: `${ERR}.no_existe`,
    })
    // Una fila sin origen (antes de la migración) es de beca, nunca de cheque.
    estado.filas = [fila({ origen: undefined })]
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'cheque' })).toEqual(
      { success: false, error: `${ERR}.no_existe` }
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ya resuelto o sin ser Dirección de su centro, no llama a la BD', async () => {
    estado.filas = [fila({ estado: 'resuelto' })]
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'cheque' })).toEqual(
      { success: false, error: `${ERR}.ya_resuelto` }
    )
    estado.filas = [fila({})]
    admin.mockResolvedValue(null)
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'cheque' })).toEqual(
      { success: false, error: `${ERR}.no_autorizado` }
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  const HINTS: Array<[string, string]> = [
    ['no_existe', `${ERR}.no_existe`],
    ['ya_resuelto', `${ERR}.ya_resuelto`],
    ['via_invalida', `${ERR}.invalid`],
    ['sin_hijos', `${ERR}.sin_hijos_cheque`],
    ['recibo_siguiente_cerrado', `${ERR}.recibo_siguiente_cerrado`],
    ['mes_siguiente_cerrado', `${ERR}.mes_siguiente_cerrado`],
  ]

  it.each(HINTS)('HINT %s → %s, que existe en es, en y va', async (hint, clave) => {
    estado.respuesta = { data: null, error: { code: 'P0001', hint, message: 'x' } }
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'cheque' })).toEqual(
      { success: false, error: clave }
    )
    for (const msgs of [es, en, va]) {
      expect(typeof hoja(msgs as Record<string, unknown>, clave), clave).toBe('string')
    }
  })

  it('42501 es «no autorizado» y un error sin HINT conocido, «no se pudo»', async () => {
    estado.respuesta = { data: null, error: { code: '42501', message: 'x' } }
    expect(await resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'cheque' })).toEqual(
      { success: false, error: `${ERR}.no_autorizado` }
    )
    estado.respuesta = { data: null, error: { code: 'XX000', message: 'x' } }
    expect(
      await resolverDesborde({ recibo_id: RECIBO, via: 'transferencia', origen: 'cheque' })
    ).toEqual({ success: false, error: `${ERR}.save_failed` })
  })
})
