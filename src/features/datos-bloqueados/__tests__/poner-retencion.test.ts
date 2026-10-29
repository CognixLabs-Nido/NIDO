// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { leerResultadoPoner } from '../lib/resultado-poner'

/**
 * Retener devuelve a pendiente las peticiones de olvido confirmadas y sin purgar (20261206120000),
 * y la familia de cada una recibe el correo de «deshecha»: el mismo que cuando la titular deshace la
 * confirmación.
 */

const h = vi.hoisted(() => ({
  respuesta: { data: null as unknown, error: null as unknown },
  avisos: [] as { solicitud: string; evento: string }[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: async () => h.respuesta }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))
vi.mock('@/features/olvido/lib/avisar', () => ({
  avisarFamilia: vi.fn(async (_s: unknown, solicitud: string, evento: string) => {
    h.avisos.push({ solicitud, evento })
    return 1
  }),
}))

const { ponerRetencion } = await import('../actions/retencion')

const ID = '11111111-1111-4111-8111-111111111111'
const ENTRADA = {
  centroId: ID,
  sujetos: [{ tipo: 'nino', id: ID }],
  motivoTipo: 'juzgado',
  motivo: 'Oficio 12/2027 del juzgado',
}

beforeEach(() => {
  h.avisos.length = 0
})

describe('poner la retención', () => {
  it('avisa con «deshecha» a la familia de cada petición devuelta a pendiente', async () => {
    h.respuesta = { data: { puestas: 2, deshechas: ['s-1', 's-2'] }, error: null }
    const r = await ponerRetencion(ENTRADA)
    expect(r).toEqual({ success: true, data: 2 })
    expect(h.avisos).toEqual([
      { solicitud: 's-1', evento: 'deshecha' },
      { solicitud: 's-2', evento: 'deshecha' },
    ])
  })

  it('sin peticiones devueltas no avisa a nadie', async () => {
    h.respuesta = { data: { puestas: 1, deshechas: [] }, error: null }
    expect(await ponerRetencion(ENTRADA)).toEqual({ success: true, data: 1 })
    expect(h.avisos).toEqual([])
  })

  it('con un error de la BD no avisa', async () => {
    h.respuesta = { data: null, error: { code: '42501' } }
    const r = await ponerRetencion(ENTRADA)
    expect(r).toEqual({ success: false, error: 'datos_bloqueados.retencion.errores.no_autorizado' })
    expect(h.avisos).toEqual([])
  })

  it('una respuesta con otra forma no se adivina', () => {
    expect(leerResultadoPoner(3)).toBeNull()
    expect(leerResultadoPoner({ puestas: 1 })).toBeNull()
    expect(leerResultadoPoner({ puestas: 1, deshechas: [7] })).toBeNull()
    expect(leerResultadoPoner({ puestas: 0, deshechas: [] })).toEqual({ puestas: 0, deshechas: [] })
  })
})
