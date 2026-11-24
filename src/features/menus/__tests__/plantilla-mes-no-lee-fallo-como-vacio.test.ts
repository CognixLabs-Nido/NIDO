import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El menú del mes (C, 2026-11-23): si `getPlantillaMes` no puede leer, lanza. Antes, un fallo de la
 * plantilla salía `null` (la página da 404, «no existe») y uno de los días salía con `menus: []` (el
 * editor abre el mes vacío y guardar un día pisa sus otros platos). La cadena entera con la página y
 * la base la mide `src/test/rls/menu-mes-no-pisa.rls.test.ts`.
 */

type Resultado = { data: unknown; error: { message: string } | null }
let falla: string | null

function consulta(tabla: string): unknown {
  const r = (): Resultado =>
    tabla === falla
      ? { data: null, error: { message: 'fallo' } }
      : {
          data: tabla === 'menu_dia' ? [{ fecha: '2027-03-03' }] : { id: 'p', centro_id: 'c' },
          error: null,
        }
  const q: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'then' ? (resolve: (x: Resultado) => unknown) => resolve(r()) : () => q,
    }
  )
  return q
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: consulta }) }))

const { getPlantillaMes } = await import('../queries/get-plantilla-mes')

describe('getPlantillaMes no lee un fallo como «no existe» ni como mes vacío', () => {
  beforeEach(() => {
    falla = null
  })

  it('control: con todo leído, plantilla y días', async () => {
    const r = await getPlantillaMes('p')
    expect(r?.menus).toEqual([{ fecha: '2027-03-03' }])
  })

  it.each(['plantillas_menu_mensual', 'menu_dia'])('si falla %s, lanza', async (tabla) => {
    falla = tabla
    await expect(getPlantillaMes('p')).rejects.toThrow('fallo')
  })
})
