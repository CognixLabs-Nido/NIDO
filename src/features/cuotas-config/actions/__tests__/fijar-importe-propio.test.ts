import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fijarImportePropio } from '../fijar-importe-propio'

/**
 * PR-6: el importe propio se escribe en la ASIGNACIÓN viva del niño o de la familia
 * (`asignacion_concepto.importe_override_centimos`, en céntimos), solo en conceptos de importe
 * fijo que el motor cobra cada mes, y cada «no» tiene su motivo propio.
 */

interface Llamada {
  tabla: string
  update?: Record<string, unknown>
  filtros: Array<[string, string, unknown]>
}

const { estado, admin } = vi.hoisted(() => ({
  estado: {
    concepto: { tipo_valor: 'fijo', tipo_concepto: 'mensual' } as Record<string, unknown> | null,
    filasActualizadas: [{ id: 'a1' }] as Array<{ id: string }>,
    errorUpdate: null as { code?: string; message: string } | null,
    llamadas: [] as Llamada[],
  },
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      const llamada: Llamada = { tabla, filtros: [] }
      estado.llamadas.push(llamada)
      const cadena = {
        select: () => cadena,
        update: (v: Record<string, unknown>) => {
          llamada.update = v
          return cadena
        },
        eq: (col: string, val: unknown) => {
          llamada.filtros.push(['eq', col, val])
          return cadena
        },
        is: (col: string, val: unknown) => {
          llamada.filtros.push(['is', col, val])
          return cadena
        },
        maybeSingle: async () => ({ data: estado.concepto, error: null }),
        // La lectura del UPDATE con `.select('id')` se espera como thenable.
        then: (res: (v: unknown) => unknown) =>
          res({
            data: estado.errorUpdate ? null : estado.filasActualizadas,
            error: estado.errorUpdate,
          }),
      }
      return cadena
    },
  }),
}))

const CENTRO = '11111111-1111-4111-8111-111111111111'
const CONCEPTO = '22222222-2222-4222-8222-222222222222'
const NINO = '33333333-3333-4333-8333-333333333333'
const FAMILIA = '44444444-4444-4444-8444-444444444444'
const base = {
  centroId: CENTRO,
  conceptoId: CONCEPTO,
  ninoId: NINO,
  familiaId: null,
  importeEuros: 30,
}

const update = () => estado.llamadas.find((l) => l.update)

describe('fijarImportePropio', () => {
  beforeEach(() => {
    estado.concepto = { tipo_valor: 'fijo', tipo_concepto: 'mensual' }
    estado.filasActualizadas = [{ id: 'a1' }]
    estado.errorUpdate = null
    estado.llamadas = []
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: escribe los céntimos en la asignación viva del niño, en su centro', async () => {
    expect(await fijarImportePropio({ ...base, importeEuros: 29.9 })).toEqual({
      success: true,
      data: undefined,
    })
    const u = update()
    expect(u?.tabla).toBe('asignacion_concepto')
    expect(u?.update).toEqual({ importe_override_centimos: 2990 })
    expect(u?.filtros).toEqual(
      expect.arrayContaining([
        ['eq', 'centro_id', CENTRO],
        ['eq', 'concepto_id', CONCEPTO],
        ['eq', 'nino_id', NINO],
        ['is', 'deleted_at', null],
      ])
    )
  })

  it('el de una familia (su descuento por hermano) va por familia_id, no por niño', async () => {
    await fijarImportePropio({ ...base, ninoId: null, familiaId: FAMILIA, importeEuros: 50 })
    const u = update()
    expect(u?.update).toEqual({ importe_override_centimos: 5000 })
    expect(u?.filtros).toContainEqual(['eq', 'familia_id', FAMILIA])
    expect(u?.filtros.some(([, col]) => col === 'nino_id')).toBe(false)
  })

  it('quitarlo (null) vuelve al precio del concepto; 0 € es un importe válido', async () => {
    await fijarImportePropio({ ...base, importeEuros: null })
    expect(update()?.update).toEqual({ importe_override_centimos: null })
    estado.llamadas = []
    await fijarImportePropio({ ...base, importeEuros: 0 })
    expect(update()?.update).toEqual({ importe_override_centimos: 0 })
  })

  it.each([
    ['porcentual', { tipo_valor: 'porcentaje', tipo_concepto: 'mensual' }],
    ['esporádico', { tipo_valor: 'fijo', tipo_concepto: 'esporadico' }],
  ])('un concepto %s no admite importe propio y no se escribe nada', async (_n, concepto) => {
    estado.concepto = concepto
    expect(await fijarImportePropio(base)).toEqual({
      success: false,
      error: 'cuotas_config.errors.importe_no_admitido',
    })
    expect(update()).toBeUndefined()
  })

  it('un diario sí lo admite (es su precio por día)', async () => {
    estado.concepto = { tipo_valor: 'fijo', tipo_concepto: 'diario' }
    expect((await fijarImportePropio({ ...base, importeEuros: 5 })).success).toBe(true)
    expect(update()?.update).toEqual({ importe_override_centimos: 500 })
  })

  it('sin fila viva: «ya no está asignado»', async () => {
    estado.filasActualizadas = []
    expect(await fijarImportePropio(base)).toEqual({
      success: false,
      error: 'cuotas_config.errors.no_asignado',
    })
  })

  it('quien no es de Dirección: «no autorizado», sin tocar la BD', async () => {
    admin.mockResolvedValue(null)
    expect(await fijarImportePropio(base)).toEqual({
      success: false,
      error: 'cuotas_config.errors.no_autorizado',
    })
    expect(estado.llamadas).toEqual([])
  })

  it.each([
    ['negativo', { importeEuros: -1 }],
    ['niño y familia a la vez', { familiaId: FAMILIA }],
    ['ni niño ni familia', { ninoId: null }],
  ])('entrada inválida (%s): no llega a la BD', async (_n, over) => {
    expect(await fijarImportePropio({ ...base, ...over })).toEqual({
      success: false,
      error: 'cuotas_config.errors.importe_invalido',
    })
    expect(estado.llamadas).toEqual([])
  })
})
