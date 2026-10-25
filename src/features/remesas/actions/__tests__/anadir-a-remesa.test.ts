import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { anadirARemesa } from '../anadir-a-remesa'
import { crearRemesa } from '../crear-remesa'

/**
 * Añadir recibos a una remesa en borrador (`20261120120000`): solo con la remesa en borrador y sin
 * fichero, todos los recibos en un solo INSERT, y lo que diga la BD traducido a una clave que existe
 * en los tres idiomas. `crearRemesa` traduce lo mismo y no deja la remesa vacía.
 */

const { estado, inserts, updates, admin } = vi.hoisted(() => ({
  estado: {
    remesa: null as Record<string, unknown> | null,
    errorInsert: null as unknown,
  },
  inserts: [] as Array<{ tabla: string; filas: unknown }>,
  updates: [] as Array<{ tabla: string; valores: unknown }>,
  admin: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({ usuarioAdminEn: admin }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: estado.remesa }) }) }),
      }),
      insert: (filas: unknown) => {
        inserts.push({ tabla, filas })
        if (tabla === 'remesas') {
          return {
            select: () => ({ single: async () => ({ data: { id: 'rem-nueva' }, error: null }) }),
          }
        }
        return Promise.resolve({ error: estado.errorInsert })
      },
      update: (valores: unknown) => {
        updates.push({ tabla, valores })
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))

const REMESA = '11111111-1111-4111-8111-111111111111'
const R1 = '22222222-2222-4222-8222-222222222222'
const R2 = '33333333-3333-4333-8333-333333333333'

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

function enLosTres(clave: string) {
  for (const msgs of [es, en, va]) expect(typeof hoja(msgs, clave), clave).toBe('string')
}

describe('anadirARemesa', () => {
  beforeEach(() => {
    estado.remesa = { id: REMESA, centro_id: 'c1', estado: 'borrador', fichero_generado_at: null }
    estado.errorInsert = null
    inserts.length = 0
    updates.length = 0
    admin.mockReset().mockResolvedValue('u1')
  })

  it('premisa: remesa en borrador sin fichero → un solo INSERT con todos los recibos', async () => {
    expect(await anadirARemesa({ remesaId: REMESA, reciboIds: [R1, R2] })).toEqual({
      success: true,
      data: null,
    })
    expect(inserts).toEqual([
      {
        tabla: 'recibos_remesa',
        filas: [
          { remesa_id: REMESA, recibo_id: R1, centro_id: 'c1' },
          { remesa_id: REMESA, recibo_id: R2, centro_id: 'c1' },
        ],
      },
    ])
  })

  it('remesa enviada o con fichero: no escribe y dice por qué', async () => {
    estado.remesa = { ...estado.remesa, estado: 'enviada' }
    expect(await anadirARemesa({ remesaId: REMESA, reciboIds: [R1] })).toEqual({
      success: false,
      error: 'remesas.errors.ya_enviada',
    })
    estado.remesa = { ...estado.remesa, estado: 'borrador', fichero_generado_at: '2026-10-25' }
    expect(await anadirARemesa({ remesaId: REMESA, reciboIds: [R1] })).toEqual({
      success: false,
      error: 'remesas.errors.remesa_con_fichero',
    })
    expect(inserts).toEqual([])
    enLosTres('remesas.errors.remesa_con_fichero')
  })

  it('sin Dirección del centro de la remesa, o sin remesa: no escribe', async () => {
    admin.mockResolvedValue(null)
    expect((await anadirARemesa({ remesaId: REMESA, reciboIds: [R1] })).success).toBe(false)
    estado.remesa = null
    expect(await anadirARemesa({ remesaId: REMESA, reciboIds: [R1] })).toEqual({
      success: false,
      error: 'remesas.errors.no_encontrada',
    })
    expect(inserts).toEqual([])
  })

  it.each([
    ['recibo_en_otra_remesa', 'remesas.errors.recibo_en_otra_remesa'],
    ['recibo_no_remesable', 'remesas.errors.recibo_no_remesable'],
    ['remesa_cerrada', 'remesas.errors.ya_enviada'],
    ['remesa_con_fichero', 'remesas.errors.remesa_con_fichero'],
    ['otra_cosa', 'remesas.errors.anadir_failed'],
  ])('la BD dice %s → %s, en los tres idiomas', async (hint, clave) => {
    estado.errorInsert = { code: 'P0001', hint, message: 'x' }
    expect(await anadirARemesa({ remesaId: REMESA, reciboIds: [R1] })).toEqual({
      success: false,
      error: clave,
    })
    enLosTres(clave)
  })
})

describe('crearRemesa', () => {
  beforeEach(() => {
    estado.errorInsert = null
    inserts.length = 0
    updates.length = 0
    admin.mockReset().mockResolvedValue('u1')
  })

  it('un recibo que ya está en otra remesa: lo dice y no deja la remesa vacía', async () => {
    estado.errorInsert = { code: 'P0001', hint: 'recibo_en_otra_remesa', message: 'x' }
    expect(await crearRemesa({ anio: 2026, mes: 3, reciboIds: [R1] }, 'c1')).toEqual({
      success: false,
      error: 'remesas.errors.recibo_en_otra_remesa',
    })
    expect(inserts.map((i) => i.tabla)).toEqual(['remesas', 'recibos_remesa'])
    expect(updates).toHaveLength(1)
    expect(updates[0]!.tabla).toBe('remesas')
    expect(updates[0]!.valores).toHaveProperty('deleted_at')
  })
})
