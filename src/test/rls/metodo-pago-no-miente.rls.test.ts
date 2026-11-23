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
 * Las dos de dinero de C (2026-11-23): una acción que lee para decidir y, si la lectura falla,
 * decide con el valor por defecto; y la tercera forma, una escritura que falla y se informa como
 * éxito.
 *
 * 1. `crearReciboConLineaManual`: el método del recibo nuevo es la excepción del mes si la hay; si
 *    falla su lectura, sale el de la ficha.
 * 2. `setMetodoPagoFamilia`: guarda la excepción del mes y la lleva al recibo borrador. Si falla la
 *    lectura del recibo, o su UPDATE, contesta `ok` y el borrador se queda con el método viejo («el
 *    recibo se corregirá al regenerar»: nada garantiza que alguien regenere).
 *
 * Lo que se afirma: si la acción dice que sí, el recibo tiene el método que Dirección eligió. Si no
 * pudo, lo dice.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({
    actual: null,
    fallaTabla: null,
    fallaRpc: null,
    fallidas: 0,
    fallaEscrituraTabla: null,
  })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos: con } = await import('./lectura-fallida')
  return { createClient: async () => con(sesion) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { crearReciboConLineaManual } = await import('@/features/recibos/actions/lineas-recibo')
const { setMetodoPagoFamilia } = await import('@/features/recibos/actions/set-metodo-pago-familia')

// Un mes futuro, abierto, sin recibos del motor.
const ANIO = 2027
const MES = 5

describe('el método de pago: ni se decide con lo que no se leyó ni se dice guardado sin estarlo', () => {
  let centroId: string
  let familia: string
  let admin: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Metodo No Miente')
    centroId = centro.id
    admin = await createTestUser({ nombre: 'Admin Metodo No Miente' })
    await asignarRol(admin.id, centro.id, 'admin')
    familia = await createTestFamilia(centro.id)
    const f = await serviceClient
      .from('familias')
      .update({ metodo_pago: 'transferencia' })
      .eq('id', familia)
    if (f.error) throw new Error(`ficha: ${f.error.message}`)
    sesion.actual = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centroId)
    await serviceClient.from('recibos').delete().eq('centro_id', centroId)
    await serviceClient.from('metodo_pago_familia').delete().eq('centro_id', centroId)
    await deleteTestCentro(centroId)
    if (admin) await deleteTestUser(admin.id)
  }, 60_000)

  beforeEach(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centroId)
    await serviceClient.from('recibos').delete().eq('centro_id', centroId)
    await serviceClient.from('metodo_pago_familia').delete().eq('centro_id', centroId)
    sesion.fallidas = 0
  })

  afterEach(() => {
    sesion.fallaTabla = null
    sesion.fallaEscrituraTabla = null
  })

  async function metodoDelRecibo() {
    const { data, error } = await serviceClient
      .from('recibos')
      .select('metodo')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('es_esporadico', false)
      .single()
    if (error) throw new Error(`leer el recibo: ${error.message}`)
    return data.metodo
  }

  async function excepcionEfectivo() {
    const r = await serviceClient.from('metodo_pago_familia').insert({
      centro_id: centroId,
      familia_id: familia,
      anio: ANIO,
      mes: MES,
      metodo: 'efectivo',
    })
    if (r.error) throw new Error(`excepción: ${r.error.message}`)
  }

  async function borradorTransferencia() {
    const r = await serviceClient.from('recibos').insert({
      centro_id: centroId,
      familia_id: familia,
      anio: ANIO,
      mes: MES,
      metodo: 'transferencia',
      estado: 'borrador',
      total_centimos: 0,
      es_esporadico: false,
    })
    if (r.error) throw new Error(`borrador: ${r.error.message}`)
  }

  const linea = {
    familiaId: '',
    anio: ANIO,
    mes: MES,
    descripcion: 'Material',
    cantidad: 1,
    precioUnitarioCentimos: 1500,
  }

  describe('1 · el recibo con una línea manual', () => {
    it('control: con la lectura bien, el recibo nace con la excepción del mes', async () => {
      await excepcionEfectivo()
      const r = await crearReciboConLineaManual({ ...linea, familiaId: familia })
      expect(r.success, 'premisa: se creó').toBe(true)
      expect(await metodoDelRecibo()).toBe('efectivo')
    })

    it('si falla la lectura de la excepción, el recibo no nace con el método de la ficha', async () => {
      await excepcionEfectivo()
      sesion.fallaTabla = 'metodo_pago_familia'
      const r = await crearReciboConLineaManual({ ...linea, familiaId: familia })
      expect(sesion.fallidas, 'premisa: la lectura de la excepción falló').toBeGreaterThan(0)
      if (r.success) expect(await metodoDelRecibo(), 'el método del recibo').toBe('efectivo')
      else expect(r.success).toBe(false)
    })
  })

  describe('2 · cambiar el método del mes', () => {
    it('control: con todo bien, el borrador pasa al método nuevo', async () => {
      await borradorTransferencia()
      const r = await setMetodoPagoFamilia(familia, ANIO, MES, 'efectivo')
      expect(r.success, 'premisa: dice que sí').toBe(true)
      expect(await metodoDelRecibo()).toBe('efectivo')
    })

    it('si falla la LECTURA del recibo, no dice que sí con el borrador en el método viejo', async () => {
      await borradorTransferencia()
      sesion.fallaTabla = 'recibos'
      const r = await setMetodoPagoFamilia(familia, ANIO, MES, 'efectivo')
      expect(sesion.fallidas, 'premisa: la lectura del recibo falló').toBeGreaterThan(0)
      if (r.success) expect(await metodoDelRecibo(), 'dijo que sí: el borrador').toBe('efectivo')
      else expect(r.success).toBe(false)
    })

    it('si falla la ESCRITURA del borrador, no dice que sí (la tercera forma)', async () => {
      await borradorTransferencia()
      sesion.fallaEscrituraTabla = 'recibos'
      const r = await setMetodoPagoFamilia(familia, ANIO, MES, 'efectivo')
      expect(sesion.fallidas, 'premisa: la escritura del recibo falló').toBeGreaterThan(0)
      if (r.success) expect(await metodoDelRecibo(), 'dijo que sí: el borrador').toBe('efectivo')
      else expect(r.success).toBe(false)
    })
  })
})
