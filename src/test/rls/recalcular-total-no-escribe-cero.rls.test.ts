import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * `recalcularTotal` (censo C, lineas-recibo 333 F2 DINERO y 338 F3 DINERO; adelantado a B1 por Jose el
 * 2026-11-26: «es el único de todo esto que ESCRIBE un importe equivocado»). Después de escribir una línea,
 * relee las líneas del recibo y escribe su suma en `recibos.total_centimos`. Con esa lectura caída, la suma
 * de `(lineas ?? [])` es 0: un recibo con líneas se quedaba en 0 € y la acción contestaba ok. Ahora no
 * escribe nada y lo dice. Contra la base efímera; lo único simulado es que la lectura de `lineas_recibo`
 * contesta error (las escrituras pasan). Fixtures ficticios del 2026-11-26.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({
    actual: null,
    fallaTabla: null,
    fallaRpc: null,
    fallidas: 0,
    fallaEscrituraTabla: null,
    fallaLecturaTabla: null,
  })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos: con } = await import('./lectura-fallida')
  return { createClient: async () => con(sesion) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { anadirLineaRecibo } = await import('@/features/recibos/actions/lineas-recibo')

// Un mes futuro, abierto, sin recibos del motor.
const ANIO = 2027
const MES = 6

describe('recalcularTotal: con la lectura de las líneas caída no escribe un total de 0', () => {
  let centroId: string
  let familia: string
  let admin: TestUser
  let reciboId: string

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Total No Cero')
    centroId = centro.id
    admin = await createTestUser({ nombre: 'Admin Total No Cero' })
    await asignarRol(admin.id, centro.id, 'admin')
    familia = await createTestFamilia(centro.id)
    sesion.actual = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centroId)
    await serviceClient.from('recibos').delete().eq('centro_id', centroId)
    await deleteTestCentro(centroId)
    if (admin) await deleteTestUser(admin.id)
  }, 60_000)

  // Un borrador con una línea de 50 € y su total al día.
  beforeEach(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centroId)
    await serviceClient.from('recibos').delete().eq('centro_id', centroId)
    const r = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroId,
        familia_id: familia,
        anio: ANIO,
        mes: MES,
        metodo: 'transferencia',
        estado: 'borrador',
        total_centimos: 5000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    if (r.error) throw new Error(`borrador: ${r.error.message}`)
    reciboId = r.data.id
    const l = await serviceClient.from('lineas_recibo').insert({
      centro_id: centroId,
      recibo_id: reciboId,
      descripcion: 'Cuota de prueba',
      cantidad: 1,
      precio_unitario_centimos: 5000,
      importe_centimos: 5000,
      origen: 'manual',
    })
    if (l.error) throw new Error(`línea: ${l.error.message}`)
    sesion.fallidas = 0
  })

  afterEach(() => {
    sesion.fallaLecturaTabla = null
  })

  const total = async () => {
    const { data, error } = await serviceClient
      .from('recibos')
      .select('total_centimos')
      .eq('id', reciboId)
      .single()
    if (error) throw new Error(`leer el total: ${error.message}`)
    return data.total_centimos
  }
  const lineas = async () =>
    (await serviceClient.from('lineas_recibo').select('id').eq('recibo_id', reciboId)).data?.length

  const nueva = () =>
    anadirLineaRecibo({
      reciboId,
      descripcion: 'Extra de prueba',
      cantidad: 1,
      precioUnitarioCentimos: 1000,
    })

  it('control: con la lectura bien, el total pasa de 50 € a 60 €', async () => {
    expect(await total(), 'premisa: el total de partida es 50 €').toBe(5000)
    const r = await nueva()
    expect(r).toEqual({ success: true, data: undefined })
    expect(await total()).toBe(6000)
  })

  it('con la lectura de las líneas caída: la línea se guarda, el total NO se escribe, y se dice', async () => {
    expect(await total(), 'premisa: el total de partida es 50 €').toBe(5000)
    sesion.fallaLecturaTabla = 'lineas_recibo'
    const r = await nueva()
    expect(sesion.fallidas, 'premisa: falló exactamente la relectura de las líneas').toBe(1)
    expect(await lineas(), 'la línea nueva SÍ se guardó').toBe(2)
    expect.soft(await total(), 'el total no se escribe con lo que no se leyó').toBe(5000)
    expect.soft(r, 'guardado, y dice que el total no se recalculó').toEqual({
      success: true,
      data: { aviso: 'recibos_panel.avisos.total_sin_recalcular' },
    })
  })
})
