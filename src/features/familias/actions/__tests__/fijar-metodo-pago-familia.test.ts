import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fijarMetodoPagoFamilia } from '../fijar-metodo-pago-familia'

/**
 * PR-7: el método de pago va en la FICHA de la familia (`familias.metodo_pago`). Cambiarlo se
 * refleja en los recibos regulares que siguen en borrador, salvo en los meses con excepción
 * (`metodo_pago_familia`), que mandan sobre la ficha. Cada «no» tiene su motivo.
 */

interface Llamada {
  tabla: string
  update?: Record<string, unknown>
  filtros: Array<[string, string, unknown]>
}

const { estado, esAdmin } = vi.hoisted(() => ({
  estado: {
    familia: { centro_id: 'c1' } as Record<string, unknown> | null,
    filaActualizada: { id: 'f1' } as { id: string } | null,
    errorUpdate: null as { code?: string; message: string } | null,
    borradores: [] as Array<{ id: string; anio: number; mes: number }>,
    excepciones: [] as Array<{ anio: number; mes: number }>,
    errorBorradores: null as { message: string } | null,
    llamadas: [] as Llamada[],
  },
  esAdmin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ esAdminEn: esAdmin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (tabla: string) => {
      const llamada: Llamada = { tabla, filtros: [] }
      estado.llamadas.push(llamada)
      const filtro = (op: string) => (col: string, val: unknown) => {
        llamada.filtros.push([op, col, val])
        return cadena
      }
      const cadena = {
        select: () => cadena,
        update: (v: Record<string, unknown>) => {
          llamada.update = v
          return cadena
        },
        eq: filtro('eq'),
        is: filtro('is'),
        in: filtro('in'),
        maybeSingle: async () =>
          llamada.update
            ? {
                data: estado.errorUpdate ? null : estado.filaActualizada,
                error: estado.errorUpdate,
              }
            : { data: estado.familia, error: null },
        // Las lecturas de lista y el UPDATE de los recibos se esperan como thenable.
        then: (res: (v: unknown) => unknown) => {
          if (llamada.update) return res({ error: null })
          if (tabla === 'recibos')
            return res({ data: estado.borradores, error: estado.errorBorradores })
          return res({ data: estado.excepciones, error: null })
        },
      }
      return cadena
    },
  }),
}))

const FAMILIA = '44444444-4444-4444-8444-444444444444'
const updateDe = (tabla: string) => estado.llamadas.find((l) => l.tabla === tabla && l.update)

describe('fijarMetodoPagoFamilia', () => {
  beforeEach(() => {
    estado.familia = { centro_id: 'c1' }
    estado.filaActualizada = { id: 'f1' }
    estado.errorUpdate = null
    estado.borradores = []
    estado.excepciones = []
    estado.errorBorradores = null
    estado.llamadas = []
    esAdmin.mockReset().mockResolvedValue(true)
  })

  it('premisa: escribe el método en la ficha de la familia', async () => {
    expect(
      await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'cheque_guarderia' })
    ).toEqual({ success: true, data: undefined })
    const u = updateDe('familias')
    expect(u?.update).toEqual({ metodo_pago: 'cheque_guarderia' })
    expect(u?.filtros).toContainEqual(['eq', 'id', FAMILIA])
    expect(esAdmin).toHaveBeenCalledWith(expect.anything(), 'u1', 'c1')
  })

  it('lo refleja en los borradores, pero no en el mes con excepción', async () => {
    estado.borradores = [
      { id: 'r-sep', anio: 2026, mes: 9 },
      { id: 'r-oct', anio: 2026, mes: 10 },
    ]
    estado.excepciones = [{ anio: 2026, mes: 10 }]

    expect(
      (await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'efectivo' })).success
    ).toBe(true)

    const lectura = estado.llamadas.find((l) => l.tabla === 'recibos' && !l.update)
    expect(lectura?.filtros).toEqual(
      expect.arrayContaining([
        ['eq', 'familia_id', FAMILIA],
        ['eq', 'estado', 'borrador'],
        ['eq', 'es_esporadico', false],
        ['is', 'devuelto_de_recibo_id', null],
        ['is', 'deleted_at', null],
      ])
    )
    const u = updateDe('recibos')
    expect(u?.update).toEqual({ metodo: 'efectivo' })
    expect(u?.filtros).toEqual([['in', 'id', ['r-sep']]])
  })

  it('sin borradores, no toca ningún recibo', async () => {
    expect((await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).success).toBe(
      true
    )
    expect(updateDe('recibos')).toBeUndefined()
  })

  it('si no puede leer los borradores, el método queda guardado y no toca recibos', async () => {
    estado.borradores = [{ id: 'r-sep', anio: 2026, mes: 9 }]
    estado.errorBorradores = { message: 'boom' }
    expect((await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).success).toBe(
      true
    )
    expect(updateDe('familias')).toBeDefined()
    expect(updateDe('recibos')).toBeUndefined()
  })

  it('quien no es Dirección de ese centro no escribe nada', async () => {
    esAdmin.mockResolvedValue(false)
    expect(await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).toEqual({
      success: false,
      error: 'auth.invitation.errors.forbidden',
    })
    expect(estado.llamadas.some((l) => l.update)).toBe(false)
  })

  it('familia que la RLS no deja ver: no encontrada', async () => {
    estado.familia = null
    expect(await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).toEqual({
      success: false,
      error: 'admin.familias.errors.no_encontrada',
    })
    expect(estado.llamadas.some((l) => l.update)).toBe(false)
  })

  it('UPDATE en 0 filas: no encontrada, y no sigue con los recibos', async () => {
    estado.filaActualizada = null
    expect(await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).toEqual({
      success: false,
      error: 'admin.familias.errors.no_encontrada',
    })
    expect(estado.llamadas.some((l) => l.tabla === 'recibos')).toBe(false)
  })

  it.each([
    ['42501', 'admin.familias.errors.no_autorizado'],
    ['XX000', 'admin.familias.metodo_pago.errors.guardado'],
  ])('error %s al guardar: %s', async (code, error) => {
    estado.errorUpdate = { code, message: 'x' }
    expect(await fijarMetodoPagoFamilia({ familia_id: FAMILIA, metodo: 'sepa' })).toEqual({
      success: false,
      error,
    })
  })

  it.each([
    [{ familia_id: 'no-uuid', metodo: 'sepa' }],
    [{ familia_id: FAMILIA, metodo: 'bizum' }],
  ])('entrada inválida %j: no toca la BD', async (input) => {
    expect(await fijarMetodoPagoFamilia(input as never)).toEqual({
      success: false,
      error: 'admin.familias.metodo_pago.errors.invalido',
    })
    expect(estado.llamadas).toHaveLength(0)
  })
})
