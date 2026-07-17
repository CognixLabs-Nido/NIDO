import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-4-1 — Esquema de recibos a grano FAMILIA (migración `20260728120000_phase_f41`).
 * Verifica:
 *  1) Un recibo REGULAR con `familia_id` NOT NULL y `nino_id` NULL se inserta; el tutor de la
 *     FAMILIA lo ve (RLS nueva `es_tutor_de_familia`); un tutor de OTRA familia no.
 *  2) `lineas_recibo.nino_id`: línea de un hijo (NOT NULL) y línea familiar (NULL) se insertan;
 *     el tutor de la familia ve ambas.
 *  3) Índice único regular por familia: 2 regulares de la misma familia/mes → 23505; un
 *     esporádico coexiste con el regular en el mismo mes.
 *  4) Los valores de ENUM nuevos existen: `metodo_pago='cheque_guarderia'` y
 *     `estado_recibo='borrador'` se aceptan.
 *
 * Gateado: F41_MIGRATION_APPLIED=1 (la migración de storage/esquema se aplica a mano por SQL
 * Editor — CLI SIGILL). No corre en CI hasta que el operador la aplica.
 */
const APPLIED = process.env.F41_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('F-4-1 — recibos a grano familia', () => {
  let centro: { id: string }
  let familiaA: string
  let familiaB: string
  let ninoA1: string // niño de familiaA (para la línea con nino_id)
  let admin: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let cAdmin: SupabaseClient<Database>
  let cTutorA: SupabaseClient<Database>
  let cTutorB: SupabaseClient<Database>

  async function insertarNino(familiaId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`insertarNino falló: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro F41')
    familiaA = await createTestFamilia(centro.id)
    familiaB = await createTestFamilia(centro.id)
    ninoA1 = await insertarNino(familiaA, 'Nino A1 F41')

    admin = await createTestUser({ nombre: 'Admin F41' })
    tutorA = await createTestUser({ nombre: 'Tutor A F41' })
    tutorB = await createTestUser({ nombre: 'Tutor B F41' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutorA.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
    await crearFamiliaTutor(familiaB, tutorB.id, 'titular')

    cAdmin = await clientFor(admin)
    cTutorA = await clientFor(tutorA)
    cTutorB = await clientFor(tutorB)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutorA.id)
    await deleteTestUser(tutorB.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('recibo regular familiar (familia_id NOT NULL, nino_id NULL): el tutor de la familia lo ve; otro NO', async () => {
    const recibo = await cAdmin
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaA,
        // nino_id omitido → NULL (recibo familiar, agrega a todos los hijos)
        anio: 2027,
        mes: 3,
        metodo: 'sepa',
        total_centimos: 15000,
        es_esporadico: false,
      })
      .select('id, familia_id, nino_id')
      .maybeSingle()
    expect(recibo.error).toBeNull()
    expect(recibo.data?.familia_id).toBe(familiaA)
    expect(recibo.data?.nino_id).toBeNull()
    const reciboId = recibo.data!.id

    // El tutor de familiaA lo ve (es_tutor_de_familia); el de familiaB no.
    const propio = await cTutorA.from('recibos').select('id').eq('id', reciboId).maybeSingle()
    expect(propio.data?.id).toBe(reciboId)
    const ajeno = await cTutorB.from('recibos').select('id').eq('id', reciboId).maybeSingle()
    expect(ajeno.data).toBeNull()
  })

  it('lineas_recibo con nino_id (hijo) y con nino_id NULL (familiar): el tutor de la familia ve ambas', async () => {
    const { data: r } = await cAdmin
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaA,
        anio: 2027,
        mes: 4,
        metodo: 'sepa',
        total_centimos: 8000,
        estado: 'borrador', // F-4-3: el freeze POR ESTADO solo deja añadir líneas a un borrador
      })
      .select('id')
      .single()
    const reciboId = r!.id

    const linHijo = await cAdmin.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      nino_id: ninoA1,
      descripcion: 'Cuota mensual · A1',
      cantidad: 1,
      precio_unitario_centimos: 10000,
      importe_centimos: 10000,
    })
    expect(linHijo.error).toBeNull()

    const linFamiliar = await cAdmin.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      // nino_id NULL → línea familiar (descuento hermanos / saldo)
      descripcion: 'Descuento hermanos',
      cantidad: 1,
      precio_unitario_centimos: -2000,
      importe_centimos: -2000,
    })
    expect(linFamiliar.error).toBeNull()

    const tutorLineas = await cTutorA
      .from('lineas_recibo')
      .select('id, nino_id')
      .eq('recibo_id', reciboId)
    expect((tutorLineas.data ?? []).length).toBe(2)
  })

  it('índice único regular por familia: 2 regulares misma familia/mes → 23505; esporádico coexiste', async () => {
    const base = {
      centro_id: centro.id,
      familia_id: familiaB,
      anio: 2027,
      mes: 5,
      metodo: 'sepa' as const,
      total_centimos: 5000,
    }
    const primero = await cAdmin
      .from('recibos')
      .insert({ ...base })
      .select('id')
      .maybeSingle()
    expect(primero.error).toBeNull()

    const duplicado = await cAdmin
      .from('recibos')
      .insert({ ...base })
      .select('id')
      .maybeSingle()
    expect(duplicado.error).not.toBeNull()
    expect(duplicado.error?.code).toBe('23505') // unique_violation

    // Un esporádico de la misma familia/mes coexiste (fuera del índice único regular).
    const esporadico = await cAdmin
      .from('recibos')
      .insert({ ...base, es_esporadico: true, concepto_esporadico: 'Uniforme' })
      .select('id')
      .maybeSingle()
    expect(esporadico.error).toBeNull()
  })

  it('ENUMs nuevos: metodo_pago=cheque_guarderia y estado_recibo=borrador se aceptan', async () => {
    const recibo = await cAdmin
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaA,
        anio: 2027,
        mes: 6,
        metodo: 'cheque_guarderia',
        estado: 'borrador',
        total_centimos: 3000,
      })
      .select('id, metodo, estado')
      .maybeSingle()
    expect(recibo.error).toBeNull()
    expect(recibo.data?.metodo).toBe('cheque_guarderia')
    expect(recibo.data?.estado).toBe('borrador')
  })
})
