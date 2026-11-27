import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/shared/lib/logger'

import { crearRemesa } from '../crear-remesa'

/**
 * Censo C (B1, 2026-11-26): si los recibos no entran en la remesa recién creada, la remesa se retira para
 * no dejar un borrador vacío. Ese retirar se esperaba y se tiraba: si fallaba, quedaba una remesa vacía en
 * borrador y la acción decía solo el motivo de los enlaces. Ahora lo dice (y que se le pueden añadir los
 * recibos, `anadirARemesa`) y va a Sentry. Fixtures ficticios.
 */
const { bd } = vi.hoisted(() => ({
  bd: {
    errEnlaces: null as unknown,
    errDeshacer: null as unknown,
    escrituras: [] as string[],
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  usuarioAdminEn: async () => true,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      insert: () => {
        bd.escrituras.push(`insert ${tabla}`)
        if (tabla === 'recibos_remesa') return Promise.resolve({ error: bd.errEnlaces })
        return { select: () => ({ single: async () => ({ data: { id: 'rem-1' }, error: null }) }) }
      },
      update: () => ({
        eq: async () => {
          bd.escrituras.push(`update ${tabla}`)
          return { error: bd.errDeshacer }
        },
      }),
    }),
  }),
}))

const ENTRADA = { anio: 2026, mes: 11, reciboIds: ['00000000-0000-4000-8000-000000000001'] }
const CAIDA = { code: 'XX000', message: 'no' }

beforeEach(() => {
  Object.assign(bd, { errEnlaces: null, errDeshacer: null, escrituras: [] })
})

describe('crearRemesa: los enlaces que fallan', () => {
  it('premisa: con los enlaces bien, crea la remesa y no retira nada', async () => {
    expect(await crearRemesa(ENTRADA, 'c-1')).toEqual({
      success: true,
      data: { remesaId: 'rem-1' },
    })
    expect(bd.escrituras).toEqual(['insert remesas', 'insert recibos_remesa'])
  })

  it('premisa de la retirada: si los enlaces fallan y la remesa se retira, el motivo de los enlaces', async () => {
    bd.errEnlaces = { code: 'P0001', hint: 'recibo_en_otra_remesa', message: 'x' }
    expect(await crearRemesa(ENTRADA, 'c-1')).toEqual({
      success: false,
      error: 'remesas.errors.recibo_en_otra_remesa',
    })
    expect(bd.escrituras).toContain('update remesas')
  })

  it('si tampoco se retira: dice que quedó una remesa vacía, y va a Sentry', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    bd.errEnlaces = CAIDA
    bd.errDeshacer = CAIDA
    expect(await crearRemesa(ENTRADA, 'c-1')).toEqual({
      success: false,
      error: 'remesas.errors.remesa_vacia_creada',
    })
    expect(error.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('remesa vacía')
    )
    error.mockRestore()
  })
})
