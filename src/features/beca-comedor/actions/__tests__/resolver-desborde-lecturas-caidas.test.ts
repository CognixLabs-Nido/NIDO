import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/shared/lib/logger'

import { resolverDesborde } from '../resolver-desborde'

/**
 * Censo C (B1, lista blanca, 2026-11-26): diferir el desborde de la BECA con una lectura o una escritura
 * caídas. Antes:
 *  - sin el desborde: «no hay un desborde pendiente»; sin los hijos: «no tiene hijos activos»; sin las
 *    líneas o los tramos: «no hay becas que repartir», o un reparto que dejaba fuera a quien no se leyó;
 *  - sin leer el cierre, el mes siguiente era «abierto» y se difería a un mes cerrado;
 *  - si los restos previos no se borraban, se insertaban los nuevos encima (dos descuentos);
 *  - si el efecto fallaba y el claim no se revertía, el desborde quedaba resuelto sin aplicar, y la
 *    acción decía solo «no se pudo» (reintentar: «ya se resolvió»).
 * Cada bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown>,
    falla: null as string | null,
    fallaEscritura: {} as Record<string, unknown>,
    escrituras: [] as string[],
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  usuarioAdminEn: async () => 'u1',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (tabla: string) => {
      let op = 'select'
      const responder = (una: boolean) => {
        if (op !== 'select') {
          const clave = `${op} ${tabla}`
          estado.escrituras.push(clave)
          const n = estado.escrituras.filter((e) => e === clave).length
          const err = estado.fallaEscritura[`${clave}#${n}`] ?? estado.fallaEscritura[clave] ?? null
          return { data: err ? null : { id: 'd1' }, error: err }
        }
        if (estado.falla === tabla)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const v = estado.filas[tabla] ?? null
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'not', 'order', 'limit']) c[m] = () => c
      c.insert = () => ((op = 'insert'), c)
      c.update = () => ((op = 'update'), c)
      c.delete = () => ((op = 'delete'), c)
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const RECIBO = '22222222-2222-4222-8222-222222222222'
const ERR = 'admin.cuotas.beca_comedor.desborde.errors'
const LECTURA_FALLIDA = { success: false, error: 'common.lectura_fallida' }
const CAIDA = { code: 'XX000', message: 'no' }
const diferir = () => resolverDesborde({ recibo_id: RECIBO, via: 'diferir', origen: 'beca' })

beforeEach(() => {
  estado.falla = null
  estado.fallaEscritura = {}
  estado.escrituras = []
  estado.filas = {
    // Un desborde de beca pendiente: la beca del niño (50 €) supera la cuota en 10 €.
    beca_comedor_desborde: [
      {
        id: 'd1',
        centro_id: 'c1',
        recibo_id: RECIBO,
        familia_id: 'f1',
        anio: 2026,
        mes: 11,
        exceso_centimos: 1000,
        estado: 'pendiente',
        origen: 'beca',
      },
    ],
    cierre_mensual: null, // diciembre abierto
    ninos: [{ id: 'n1' }],
    lineas_recibo: [{ beca_tramo_id: 't1' }],
    beca_comedor_tramo: [{ nino_id: 'n1', importe_centimos: 5000, curso_academico_id: 'curso-1' }],
  }
})

describe('diferir el desborde de la beca', () => {
  it('premisa: con todo leído, reclama, borra los restos previos e inserta el nuevo', async () => {
    expect(await diferir()).toEqual({ success: true, data: { via: 'diferir', n: 1 } })
    expect(estado.escrituras).toEqual([
      'update beca_comedor_desborde',
      'delete beca_comedor_tramo',
      'insert beca_comedor_tramo',
    ])
  })

  it('premisa del cierre: con el mes siguiente cerrado, no difiere', async () => {
    estado.filas.cierre_mensual = { id: 'cierre-dic' }
    expect(await diferir()).toEqual({ success: false, error: `${ERR}.mes_siguiente_cerrado` })
  })

  it.each([
    'beca_comedor_desborde',
    'cierre_mensual',
    'ninos',
    'lineas_recibo',
    'beca_comedor_tramo',
  ])('con %s caída: no da un motivo falso ni difiere a ciegas, y no escribe', async (tabla) => {
    estado.falla = tabla
    expect(await diferir()).toEqual(LECTURA_FALLIDA)
    expect(estado.escrituras).toEqual([])
  })

  it('si los restos previos no se borran: no inserta los nuevos encima, y revierte el claim', async () => {
    estado.fallaEscritura['delete beca_comedor_tramo'] = CAIDA
    expect(await diferir()).toEqual({ success: false, error: `${ERR}.save_failed` })
    expect(estado.escrituras).not.toContain('insert beca_comedor_tramo')
    expect(estado.escrituras.filter((e) => e === 'update beca_comedor_desborde')).toHaveLength(2)
  })

  it('premisa de la reversión: si el efecto falla y el claim se revierte, «no se pudo»', async () => {
    estado.fallaEscritura['insert beca_comedor_tramo'] = CAIDA
    expect(await diferir()).toEqual({ success: false, error: `${ERR}.save_failed` })
  })

  it('si el efecto falla y el claim tampoco se revierte: lo dice, y va a Sentry', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    estado.fallaEscritura['insert beca_comedor_tramo'] = CAIDA
    estado.fallaEscritura['update beca_comedor_desborde#2'] = CAIDA
    expect(await diferir()).toEqual({ success: false, error: `${ERR}.resuelto_sin_aplicar` })
    expect(error.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('quedó resuelto')
    )
    error.mockRestore()
  })
})
