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
  },
  pasos: [] as string[],
}))

vi.mock('@/features/remesas/lib/preparar-remesa', () => ({
  prepararRemesa: () =>
    estado.sale ? { ok: true, xml: '<xml/>' } : { ok: false, motivo: 'remesa_vacia' },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({ maybeSingle: async () => ({ data: estado.remesa }) }),
          maybeSingle: async () => ({ data: { nombre: 'Centro' } }),
        }),
      }),
      update: () => ({
        eq: () => ({
          is: async () => {
            pasos.push(`marca ${tabla}`)
            return { error: null }
          },
        }),
      }),
    }),
    rpc: async (nombre: string) => {
      pasos.push(nombre)
      return { data: [], error: null }
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

  it('enviada o ya marcada: se vuelve a bajar sin marcar', async () => {
    estado.remesa = { ...estado.remesa, estado: 'enviada' }
    expect((await pedir()).status).toBe(200)
    estado.remesa = { ...estado.remesa, estado: 'borrador', fichero_generado_at: '2026-10-25' }
    expect((await pedir()).status).toBe(200)
    expect(pasos).not.toContain('marca remesas')
  })
})
