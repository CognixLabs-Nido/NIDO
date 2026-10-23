import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarReciboDevuelto } from '../marcar-recibo-devuelto'

/**
 * PR-2: «Marcar devuelto» guarda la fecha que dice el banco (no la de hoy) y los gastos en
 * céntimos, sin tocar la fecha de envío; no acepta una fecha futura ni anterior al envío; y solo
 * devuelve un recibo enviado al banco.
 */

const { estado, update, admin } = vi.hoisted(() => ({
  estado: {
    recibo: {
      id: 'r1',
      centro_id: 'c1',
      estado: 'enviado_banco',
      fecha_envio_banco: '2026-10-05',
    } as Record<string, unknown> | null,
    respuesta: { data: { id: 'r1' } as unknown, error: null as unknown },
  },
  update: vi.fn(),
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
      update: (valores: unknown) => {
        update(valores)
        return {
          eq: () => ({
            eq: () => ({ select: () => ({ maybeSingle: async () => estado.respuesta }) }),
          }),
        }
      },
    }),
  }),
}))

const RECIBO = '22222222-2222-4222-8222-222222222222'
const base = { reciboId: RECIBO, fecha: '2026-10-20', gastos_euros: 3.5 }

describe('marcarReciboDevuelto', () => {
  beforeEach(() => {
    estado.recibo = {
      id: 'r1',
      centro_id: 'c1',
      estado: 'enviado_banco',
      fecha_envio_banco: '2026-10-05',
    }
    estado.respuesta = { data: { id: 'r1' }, error: null }
    update.mockReset()
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: guarda la fecha del banco y los gastos en céntimos, sin tocar el envío', async () => {
    expect(await marcarReciboDevuelto(base)).toEqual({ success: true, data: null })
    expect(update).toHaveBeenCalledWith({
      estado: 'devuelto',
      fecha_devolucion: '2026-10-20',
      devolucion_gastos_centimos: 350,
    })
    expect(update.mock.calls[0]![0]).not.toHaveProperty('fecha_envio_banco')
  })

  it('sin gastos se guarda 0, no NULL', async () => {
    await marcarReciboDevuelto({ ...base, gastos_euros: 0 })
    expect(update.mock.calls[0]![0]).toMatchObject({ devolucion_gastos_centimos: 0 })
  })

  it('una fecha futura no, y no llega a leer el recibo', async () => {
    expect(await marcarReciboDevuelto({ ...base, fecha: '2026-10-23' })).toEqual({
      success: false,
      error: 'remesas.validation.fecha_devolucion_futura',
    })
    expect(admin).not.toHaveBeenCalled()
  })

  it('una fecha anterior al envío no, y no se escribe nada', async () => {
    expect(await marcarReciboDevuelto({ ...base, fecha: '2026-10-04' })).toEqual({
      success: false,
      error: 'remesas.validation.devolucion_antes_del_envio',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('un recibo que no está en el banco no se devuelve', async () => {
    estado.recibo = { ...estado.recibo!, estado: 'devuelto' }
    expect(await marcarReciboDevuelto(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_devolvible',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('quien no es Dirección del centro del recibo, no', async () => {
    admin.mockResolvedValue(null)
    expect(await marcarReciboDevuelto(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('el trigger de la BD (fecha futura por otra vía): su HINT se traduce', async () => {
    estado.respuesta = {
      data: null,
      error: { code: '22023', hint: 'fecha_devolucion_invalida', message: 'x' },
    }
    expect(await marcarReciboDevuelto(base)).toEqual({
      success: false,
      error: 'remesas.validation.fecha_devolucion_futura',
    })
  })

  it('0 filas (el estado cambió entre medias): no devolvible', async () => {
    estado.respuesta = { data: null, error: null }
    expect(await marcarReciboDevuelto(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_devolvible',
    })
  })
})
