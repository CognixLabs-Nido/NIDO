import { beforeEach, describe, expect, it, vi } from 'vitest'

import { crearCarga, editarCarga } from '../cargas-beca'

/**
 * PR-10: una carga lleva el importe de CADA becado. Crear inserta un tramo por alumno con
 * importe; editar cambia importes, añade al becado que llegó después de la carga y quita a quien
 * se queda sin importe, sin tocar lo ya descontado. Cada «no» con su motivo y sin escribir nada.
 */

type Fila = Record<string, unknown>
interface Llamada {
  tabla: string
  op: 'select' | 'insert' | 'update' | 'delete'
  valor?: unknown
  filtros: Array<[string, string, unknown]>
}

const { estado, admin } = vi.hoisted(() => ({
  estado: {
    tramos: [] as Fila[],
    becados: [] as string[],
    cerrados: [] as Array<[number, number]>,
    errorEscritura: null as { code?: string; hint?: string; message: string } | null,
    llamadas: [] as Llamada[],
  },
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/features/cursos/queries/get-cursos', () => ({
  getCursoActivo: async () => ({ id: 'curso-1' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      const llamada: Llamada = { tabla, op: 'select', filtros: [] }
      estado.llamadas.push(llamada)
      const filtro = (tipo: string) => (col: string, val: unknown) => {
        llamada.filtros.push([tipo, col, val])
        return cadena
      }
      const respuesta = () => {
        if (llamada.op !== 'select') return { data: null, error: estado.errorEscritura }
        if (tabla === 'beca_comedor_tramo') return { data: estado.tramos, error: null }
        if (tabla === 'beca_comedor_elegibilidad') {
          return { data: estado.becados.map((nino_id) => ({ nino_id })), error: null }
        }
        return { data: [], error: null }
      }
      const cadena = {
        select: () => cadena,
        insert: (v: unknown) => {
          llamada.op = 'insert'
          llamada.valor = v
          return cadena
        },
        update: (v: unknown) => {
          llamada.op = 'update'
          llamada.valor = v
          return cadena
        },
        delete: () => {
          llamada.op = 'delete'
          return cadena
        },
        eq: filtro('eq'),
        in: filtro('in'),
        limit: () => cadena,
        maybeSingle: async () => {
          // Solo cierre_mensual lee con maybeSingle.
          const anio = llamada.filtros.find((f) => f[1] === 'anio')?.[2]
          const mes = llamada.filtros.find((f) => f[1] === 'mes')?.[2]
          const cerrado = estado.cerrados.some(([a, m]) => a === anio && m === mes)
          return { data: cerrado ? { id: 'c' } : null, error: null }
        },
        then: (res: (v: unknown) => unknown) => res(respuesta()),
      }
      return cadena
    },
  }),
}))

const CENTRO = '00000000-0000-4000-8000-00000000000c'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'

const meses = {
  anio_correspondiente: 2026,
  mes_correspondiente: 9,
  anio_aplicacion: 2027,
  mes_aplicacion: 1,
}
const tramo = (id: string, nino: string, importe: number, estadoTramo = 'pendiente'): Fila => ({
  id,
  nino_id: nino,
  importe_centimos: importe,
  estado: estadoTramo,
  anio_aplicacion: 2027,
  mes_aplicacion: 1,
})

const escrituras = () => estado.llamadas.filter((l) => l.op !== 'select')
const de = (op: Llamada['op']) => escrituras().filter((l) => l.op === op)
const ids = (l: Llamada) => l.filtros.find((f) => f[0] === 'in' && f[1] === 'id')?.[2]

describe('crearCarga', () => {
  beforeEach(() => {
    estado.tramos = []
    estado.becados = [A, B, C]
    estado.cerrados = []
    estado.errorEscritura = null
    estado.llamadas = []
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: un tramo por becado con SU importe, en céntimos; sin importe, ninguno', async () => {
    const r = await crearCarga(
      {
        ...meses,
        importes: [
          { nino_id: A, importe_euros: 50 },
          { nino_id: B, importe_euros: 32.5 },
          { nino_id: C, importe_euros: null },
        ],
      },
      CENTRO
    )
    expect(r).toEqual({ success: true, data: { n: 2 } })
    const [ins] = de('insert')
    expect(de('insert')).toHaveLength(1)
    expect(ins!.tabla).toBe('beca_comedor_tramo')
    expect(ins!.valor).toEqual([
      expect.objectContaining({ nino_id: A, importe_centimos: 5000 }),
      expect.objectContaining({ nino_id: B, importe_centimos: 3250 }),
    ])
    expect(ins!.valor).toEqual([
      expect.objectContaining({
        centro_id: CENTRO,
        curso_academico_id: 'curso-1',
        ...meses,
        origen: 'normal',
        estado: 'pendiente',
      }),
      expect.anything(),
    ])
  })

  it('un alumno sin la beca activa no recibe tramo: no_becado y nada escrito', async () => {
    const r = await crearCarga(
      {
        ...meses,
        importes: [
          { nino_id: A, importe_euros: 50 },
          { nino_id: D, importe_euros: 50 },
        ],
      },
      CENTRO
    )
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.no_becado' })
    expect(escrituras()).toEqual([])
  })

  it('ningún importe: sin_importes', async () => {
    const r = await crearCarga(
      { ...meses, importes: [{ nino_id: A, importe_euros: null }] },
      CENTRO
    )
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.sin_importes' })
    expect(escrituras()).toEqual([])
  })

  it('ya hay carga para ese mes correspondiente: ya_existe', async () => {
    estado.tramos = [tramo('t1', A, 5000)]
    const r = await crearCarga({ ...meses, importes: [{ nino_id: B, importe_euros: 50 }] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.ya_existe' })
    expect(escrituras()).toEqual([])
  })

  it('mes de aplicación cerrado: mes_cerrado', async () => {
    estado.cerrados = [[2027, 1]]
    const r = await crearCarga({ ...meses, importes: [{ nino_id: A, importe_euros: 50 }] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.mes_cerrado' })
    expect(escrituras()).toEqual([])
  })

  it('sin ser Dirección del centro: no_autorizado, sin leer los tramos', async () => {
    admin.mockResolvedValue(null)
    const r = await crearCarga({ ...meses, importes: [{ nino_id: A, importe_euros: 50 }] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.no_autorizado' })
    expect(estado.llamadas).toEqual([])
  })
})

describe('editarCarga', () => {
  beforeEach(() => {
    estado.tramos = [tramo('t1', A, 5000), tramo('t2', B, 5000), tramo('t3', C, 5000, 'aplicada')]
    estado.becados = [A, B, C, D]
    estado.cerrados = []
    estado.errorEscritura = null
    estado.llamadas = []
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: cambia un importe, quita otro, añade al becado de después y deja el descontado', async () => {
    const r = await editarCarga(
      {
        ...meses,
        importes: [
          { nino_id: A, importe_euros: 30 },
          { nino_id: B, importe_euros: null },
          { nino_id: D, importe_euros: 45 },
        ],
      },
      CENTRO
    )
    expect(r).toEqual({ success: true, data: { n: 1 } })
    expect(de('delete').map(ids)).toEqual([['t2']])
    expect(de('update').map((l) => [l.valor, ids(l)])).toEqual([
      [{ importe_centimos: 3000 }, ['t1']],
    ])
    expect(de('insert').map((l) => l.valor)).toEqual([
      [
        expect.objectContaining({
          nino_id: D,
          importe_centimos: 4500,
          ...meses,
          estado: 'pendiente',
        }),
      ],
    ])
    // El descontado (C) no aparece en ninguna escritura.
    expect(JSON.stringify(escrituras())).not.toContain('t3')
  })

  it('guardar otra vez lo mismo no escribe nada', async () => {
    const r = await editarCarga(
      {
        ...meses,
        importes: [
          { nino_id: A, importe_euros: 50 },
          { nino_id: B, importe_euros: 50 },
        ],
      },
      CENTRO
    )
    expect(r.success).toBe(true)
    expect(escrituras()).toEqual([])
  })

  it('cambiar el importe de un tramo descontado: carga_aplicada y nada escrito', async () => {
    const r = await editarCarga(
      {
        ...meses,
        importes: [
          { nino_id: A, importe_euros: 30 },
          { nino_id: C, importe_euros: 30 },
        ],
      },
      CENTRO
    )
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.carga_aplicada' })
    expect(escrituras()).toEqual([])
  })

  it('con un tramo descontado, la carga no cambia de mes', async () => {
    const r = await editarCarga({ ...meses, mes_aplicacion: 2, importes: [] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.carga_aplicada' })
    expect(escrituras()).toEqual([])
  })

  it('sin tramos descontados, cambiar de mes mueve los pendientes que siguen', async () => {
    estado.tramos = [tramo('t1', A, 5000), tramo('t2', B, 5000)]
    const r = await editarCarga(
      { ...meses, mes_aplicacion: 2, importes: [{ nino_id: B, importe_euros: null }] },
      CENTRO
    )
    expect(r.success).toBe(true)
    expect(de('delete').map(ids)).toEqual([['t2']])
    expect(de('update').map((l) => [l.valor, ids(l)])).toEqual([
      [{ anio_aplicacion: 2027, mes_aplicacion: 2 }, ['t1']],
    ])
  })

  it('añadir a quien no tiene la beca activa: no_becado', async () => {
    estado.becados = [A, B, C]
    const r = await editarCarga({ ...meses, importes: [{ nino_id: D, importe_euros: 45 }] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.no_becado' })
    expect(escrituras()).toEqual([])
  })

  it('el mes actual o el nuevo cerrado: mes_cerrado', async () => {
    estado.cerrados = [[2027, 1]]
    expect(await editarCarga({ ...meses, importes: [] }, CENTRO)).toEqual({
      success: false,
      error: 'admin.cuotas.beca_comedor.errors.mes_cerrado',
    })
    estado.cerrados = [[2027, 3]]
    estado.tramos = [tramo('t1', A, 5000)]
    expect(await editarCarga({ ...meses, mes_aplicacion: 3, importes: [] }, CENTRO)).toEqual({
      success: false,
      error: 'admin.cuotas.beca_comedor.errors.mes_cerrado',
    })
    expect(escrituras()).toEqual([])
  })

  it('el trigger dice que ya está descontado (HINT beca_aplicada): carga_aplicada', async () => {
    estado.errorEscritura = { code: 'P0001', hint: 'beca_aplicada', message: 'x' }
    const r = await editarCarga({ ...meses, importes: [{ nino_id: A, importe_euros: 30 }] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.carga_aplicada' })
  })

  it('la carga ya no existe: no_existe', async () => {
    estado.tramos = []
    const r = await editarCarga({ ...meses, importes: [] }, CENTRO)
    expect(r).toEqual({ success: false, error: 'admin.cuotas.beca_comedor.errors.no_existe' })
  })
})
