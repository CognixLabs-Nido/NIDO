import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '../route'

/**
 * El fichero de una remesa en borrador marca `fichero_generado_at` la primera vez (`20261120120000`).
 * La marca va ANTES de leer los recibos que van en el fichero: uno añadido entre la lectura y la
 * marca quedaría en la remesa sin estar en el fichero. Antes se comprueba que el fichero sale, para
 * no cerrar una remesa con un 422. La de una remesa enviada o ya marcada se vuelve a bajar sin marcar.
 */

const { estado, pasos } = vi.hoisted(() => ({
  estado: {
    remesa: null as Record<string, unknown> | null,
    sale: true,
    errorMarca: null as unknown,
    // Lo que devuelve get_mandatos_remesa y las lecturas del concepto (forma de producción: el
    // recibo es de la familia y el niño sale de las líneas).
    mandatos: [] as Record<string, unknown>[],
    tablas: {} as Record<string, { data: unknown[]; error: unknown }>,
    conceptos: null as Map<string, string> | null,
  },
  pasos: [] as string[],
}))

vi.mock('@/features/remesas/lib/preparar-remesa', () => ({
  prepararRemesa: (_r: unknown, _a: unknown, _m: unknown, conceptos: Map<string, string>) => {
    estado.conceptos = conceptos
    return estado.sale ? { ok: true, xml: '<xml/>' } : { ok: false, motivo: 'remesa_vacia' }
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({ maybeSingle: async () => ({ data: estado.remesa }) }),
          maybeSingle: async () => ({ data: { nombre: 'CEI Ejemplo' } }),
          in: async () => {
            pasos.push(`lee ${tabla}`)
            return estado.tablas[tabla] ?? { data: [], error: null }
          },
        }),
      }),
      update: () => ({
        eq: () => ({
          is: async () => {
            pasos.push(`marca ${tabla}`)
            return { error: estado.errorMarca }
          },
        }),
      }),
    }),
    rpc: async (nombre: string) => {
      pasos.push(nombre)
      return { data: nombre === 'get_mandatos_remesa' ? estado.mandatos : [], error: null }
    },
  }),
}))

const ID = '11111111-1111-4111-8111-111111111111'
const pedir = () =>
  GET(new Request('http://x'), { params: Promise.resolve({ locale: 'es', id: ID }) })

describe('GET /admin/remesas/[id]/xml', () => {
  beforeEach(() => {
    estado.remesa = {
      id: ID,
      centro_id: 'c1',
      anio: 2026,
      mes: 3,
      estado: 'borrador',
      fichero_generado_at: null,
    }
    estado.sale = true
    estado.errorMarca = null
    estado.mandatos = []
    estado.tablas = {}
    estado.conceptos = null
    pasos.length = 0
  })

  it('primera vez en borrador: comprueba, marca y vuelve a leer los recibos después de marcar', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<xml/>')
    expect(pasos).toEqual([
      'get_mandatos_remesa',
      'get_datos_acreedor',
      'marca remesas',
      'get_mandatos_remesa',
      'get_datos_acreedor',
    ])
  })

  it('si el fichero no sale (422), no marca la remesa', async () => {
    estado.sale = false
    const res = await pedir()
    expect(res.status).toBe(422)
    expect(pasos).not.toContain('marca remesas')
  })

  it('desplegado antes que la migración (PGRST204): el fichero sale como antes, sin marca', async () => {
    estado.errorMarca = { code: 'PGRST204', message: 'column not found' }
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<xml/>')
    // Otro error al marcar sí corta: no se sirve un fichero de una remesa que no quedó cerrada.
    estado.errorMarca = { code: '42501', message: 'x' }
    expect((await pedir()).status).toBe(500)
  })

  it('enviada o ya marcada: se vuelve a bajar sin marcar', async () => {
    estado.remesa = { ...estado.remesa, estado: 'enviada' }
    expect((await pedir()).status).toBe(200)
    estado.remesa = { ...estado.remesa, estado: 'borrador', fichero_generado_at: '2026-10-25' }
    expect((await pedir()).status).toBe(200)
    expect(pasos).not.toContain('marca remesas')
  })

  describe('el concepto de cada adeudo', () => {
    const RECIBO = '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26'
    const NINO = 'aaaaaaaa-0000-4000-8000-000000000001'

    beforeEach(() => {
      estado.remesa = { ...estado.remesa, estado: 'enviada' }
      estado.mandatos = [{ recibo_id: RECIBO }]
      estado.tablas = {
        recibos: { data: [{ id: RECIBO, anio: 2026, mes: 10 }], error: null },
        lineas_recibo: { data: [{ recibo_id: RECIBO, nino_id: NINO }], error: null },
        ninos: { data: [{ id: NINO, nombre: 'Niña', apellidos: 'Demo Uno' }], error: null },
      }
    })

    it('lleva el centro, el niño de las líneas y el mes del recibo', async () => {
      expect((await pedir()).status).toBe(200)
      expect(pasos).toEqual(
        expect.arrayContaining(['lee recibos', 'lee lineas_recibo', 'lee ninos'])
      )
      expect(estado.conceptos?.get(RECIBO)).toBe('CEI Ejemplo · Nina Demo Uno · Octubre 2026')
    })

    it('si falla una lectura del concepto, no sale el fichero (500)', async () => {
      estado.tablas.lineas_recibo = { data: [], error: { code: '42501', message: 'x' } }
      expect((await pedir()).status).toBe(500)
      expect(estado.conceptos).toBeNull()
    })
  })
})
