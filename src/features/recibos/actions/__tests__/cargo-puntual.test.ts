import { beforeEach, describe, expect, it, vi } from 'vitest'

import { anadirCargoPuntual } from '../cargo-puntual'

/**
 * PR-13: la acción del cargo puntual llama a `anadir_cargo_puntual` con la sesión de Dirección y
 * traduce cada «no» a su motivo. Una entrada inválida no llega a la BD, y una respuesta que no se
 * entiende no se presenta como un fallo: el cargo ya está guardado.
 */

const { estado } = vi.hoisted(() => ({
  estado: {
    llamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    data: null as unknown,
    error: null as { code?: string; message: string } | null,
    revalidado: [] as string[],
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: (p: string) => estado.revalidado.push(p) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.llamadas.push({ fn, args })
      return { data: estado.data, error: estado.error }
    },
  }),
}))

const CENTRO = '11111111-1111-4111-8111-111111111111'
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const CONCEPTO = 'c0000000-0000-4000-8000-000000000003'
const FAM = 'f0000000-0000-4000-8000-000000000004'
const REC = 'e0000000-0000-4000-8000-000000000005'

const entrada = {
  centroId: CENTRO,
  anio: 2026,
  mes: 11,
  ninoIds: [A, B],
  descripcion: ' Excursión a la granja ',
  importeCentimos: 1200,
}

beforeEach(() => {
  estado.llamadas = []
  estado.data = []
  estado.error = null
  estado.revalidado = []
})

describe('anadirCargoPuntual', () => {
  it('llama a la RPC con todo y devuelve las filas validadas', async () => {
    const filas = [
      {
        nino_id: A,
        familia_id: FAM,
        familia_etiqueta: 'Familia Demo',
        recibo_id: REC,
        resultado: 'incluido',
        estado: 'borrador',
      },
    ]
    estado.data = filas
    const r = await anadirCargoPuntual({ ...entrada, conceptoId: CONCEPTO })
    expect(r).toEqual({ success: true, data: { filas } })
    expect(estado.llamadas).toEqual([
      {
        fn: 'anadir_cargo_puntual',
        args: {
          p_centro_id: CENTRO,
          p_anio: 2026,
          p_mes: 11,
          p_nino_ids: [A, B],
          p_descripcion: 'Excursión a la granja',
          p_importe_centimos: 1200,
          p_concepto_id: CONCEPTO,
        },
      },
    ])
    expect(estado.revalidado).toEqual(['/[locale]/admin/cuotas'])
  })

  it('sin concepto, no manda p_concepto_id (la RPC lo toma por NULL)', async () => {
    await anadirCargoPuntual({ ...entrada, conceptoId: null })
    expect(estado.llamadas[0]!.args.p_concepto_id).toBeUndefined()
  })

  it.each([
    [{ code: '42501', message: 'no autorizado' }, 'recibos_panel.errors.no_autorizado'],
    [
      { code: 'P0001', message: 'mes cerrado: 2026-11 no admite cargos' },
      'cargo_puntual.errors.mes_cerrado',
    ],
    [
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      'cargo_puntual.errors.a_la_vez',
    ],
    [
      { code: '22023', message: 'cargo puntual: importe fuera de rango' },
      'cargo_puntual.errors.invalido',
    ],
    // Un P0001 que no es el mes cerrado (el congelado de un recibo, por ejemplo) no se disfraza.
    [{ code: 'P0001', message: 'recibo confirmado: las líneas…' }, 'cargo_puntual.errors.failed'],
    [{ code: 'XX000', message: 'boom' }, 'cargo_puntual.errors.failed'],
  ])('el error %o es %s, y no revalida', async (error, motivo) => {
    estado.error = error
    expect(await anadirCargoPuntual(entrada)).toEqual({ success: false, error: motivo })
    expect(estado.revalidado).toEqual([])
  })

  it('una respuesta con un resultado desconocido: guardado, sin resumen', async () => {
    estado.data = [
      {
        nino_id: A,
        familia_id: FAM,
        familia_etiqueta: 'Familia Demo',
        recibo_id: REC,
        resultado: 'otra_cosa',
        estado: 'borrador',
      },
    ]
    expect(await anadirCargoPuntual(entrada)).toEqual({
      success: false,
      error: 'cargo_puntual.errors.sin_resumen',
    })
    // Lo guardado se ve al recargar.
    expect(estado.revalidado).toEqual(['/[locale]/admin/cuotas'])
  })

  it.each([
    ['sin niños', { ninoIds: [] }, 'cargo_puntual.errors.sin_ninos'],
    ['importe 0', { importeCentimos: 0 }, 'cargo_puntual.errors.importe_invalido'],
    ['un centro que no es un uuid', { centroId: 'x' }, 'cargo_puntual.errors.invalido'],
  ])('una entrada inválida (%s) no llega a la BD', async (_, cambio, motivo) => {
    expect(await anadirCargoPuntual({ ...entrada, ...cambio })).toEqual({
      success: false,
      error: motivo,
    })
    expect(estado.llamadas).toEqual([])
  })
})
