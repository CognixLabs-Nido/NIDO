import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marcarCobradoManual } from '../marcar-cobrado-manual'

/**
 * PR-1a: «Marcar cobrado» guarda la forma, la fecha y la nota; no toca las fechas de banco; no
 * cobra un SEPA pendiente (va por remesa) ni una fecha futura; y traduce el error de la BD.
 * PR-2: un devuelto tampoco: tiene una sola salida y va por «Resolver devolución».
 */

const { estado, update, admin } = vi.hoisted(() => ({
  estado: {
    recibo: {
      id: 'r1',
      centro_id: 'c1',
      estado: 'pendiente_procesar',
      metodo: 'efectivo',
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
const base = { reciboId: RECIBO, forma: 'efectivo' as const, fecha: '2026-10-20' }

describe('marcarCobradoManual', () => {
  beforeEach(() => {
    estado.recibo = { id: 'r1', centro_id: 'c1', estado: 'pendiente_procesar', metodo: 'efectivo' }
    estado.respuesta = { data: { id: 'r1' }, error: null }
    update.mockReset()
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: un pendiente en efectivo se cobra con forma, fecha y nota, sin tocar las fechas de banco', async () => {
    expect(await marcarCobradoManual({ ...base, nota: '  Pagó en secretaría  ' })).toEqual({
      success: true,
      data: null,
    })
    expect(update).toHaveBeenCalledWith({
      estado: 'cobrado_manual',
      cobro_forma: 'efectivo',
      cobro_fecha: '2026-10-20',
      cobro_nota: 'Pagó en secretaría',
    })
    const valores = update.mock.calls[0]![0] as Record<string, unknown>
    expect(valores).not.toHaveProperty('fecha_envio_banco')
    expect(valores).not.toHaveProperty('fecha_devolucion')
  })

  it('sin nota o con la nota en blanco, guarda NULL', async () => {
    await marcarCobradoManual({ ...base, nota: '   ' })
    expect(update.mock.calls[0]![0]).toMatchObject({ cobro_nota: null })
  })

  it('un devuelto no (PR-2): tiene una sola salida, y no se escribe nada', async () => {
    estado.recibo = { id: 'r1', centro_id: 'c1', estado: 'devuelto', metodo: 'sepa' }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.devolucion_por_resolver',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('un SEPA pendiente no: va por remesa, y no se escribe nada', async () => {
    estado.recibo = { id: 'r1', centro_id: 'c1', estado: 'pendiente_procesar', metodo: 'sepa' }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.sepa_por_remesa',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('un borrador no se cobra', async () => {
    estado.recibo = { id: 'r1', centro_id: 'c1', estado: 'borrador', metodo: 'efectivo' }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_cobrable_manual',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('una fecha futura no, y no llega a leer el recibo', async () => {
    expect(await marcarCobradoManual({ ...base, fecha: '2026-10-23' })).toEqual({
      success: false,
      error: 'remesas.validation.fecha_cobro_futura',
    })
    expect(admin).not.toHaveBeenCalled()
  })

  it('quien no es Dirección del centro del recibo, no', async () => {
    admin.mockResolvedValue(null)
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_autorizado',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('el trigger de la BD (otra carrera): su HINT se traduce', async () => {
    estado.respuesta = {
      data: null,
      error: { code: 'P0001', hint: 'sepa_por_remesa', message: 'x' },
    }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.sepa_por_remesa',
    })
  })

  it('el trigger de la devolución (se devolvió entre medias): su HINT se traduce', async () => {
    estado.respuesta = {
      data: null,
      error: { code: 'P0001', hint: 'devolucion_por_funcion', message: 'x' },
    }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.devolucion_por_resolver',
    })
  })

  it('0 filas (el estado cambió entre medias): no cobrable', async () => {
    estado.respuesta = { data: null, error: null }
    expect(await marcarCobradoManual(base)).toEqual({
      success: false,
      error: 'remesas.errors.no_cobrable_manual',
    })
  })
})
