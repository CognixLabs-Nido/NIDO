import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * B1-0 — RLS + constraints de `tarifa_concepto_anio` (importe de concepto por año de
 * nacimiento) y del flag `conceptos_cobro.tarifa_por_anio_nacimiento`.
 *
 * Cubre:
 *  - RLS admin-only por centro (SELECT/INSERT/UPDATE/DELETE vía `es_admin(centro_id)`):
 *    outsider, profe y tutor NO ven ni escriben; el admin del centro sí.
 *  - Coherencia de centro (`centro_id = centro_de_concepto(concepto_id)` en el WITH CHECK
 *    de INSERT/UPDATE): un admin del centro A no puede colgar una tarifa de un concepto de
 *    OTRO centro (ni poniendo centro_id=A ni centro_id=B).
 *  - UNIQUE (concepto_id, anio_nacimiento) → 23505; CHECK importe_centimos >= 0 → 23514.
 *
 * NOTA DE SEMÁNTICA RLS (no es un bug, = D-6): un INSERT que viola el WITH CHECK devuelve
 * 42501, pero un UPDATE/DELETE de un no-admin NO da error — la USING oculta la fila, así que
 * afecta 0 filas y devuelve `{ data: [], error: null }`. El invariante ("el no-admin no
 * modifica/borra") se prueba comprobando por serviceClient que la fila sobrevive intacta.
 *
 * Gateado: B1_TARIFA_ANIO_APPLIED=1 (requiere phase_b1_0 aplicada en la BD de test).
 */

const APPLIED = process.env.B1_TARIFA_ANIO_APPLIED === '1'

describe.skipIf(!APPLIED)('B1 — tarifa_concepto_anio RLS + constraints', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let outsider: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cProfe: Awaited<ReturnType<typeof clientFor>>
  let cTutor: Awaited<ReturnType<typeof clientFor>>
  let cOutsider: Awaited<ReturnType<typeof clientFor>>
  let conceptoA: string // concepto de centroA
  let conceptoB: string // concepto de centroB

  // Crea un concepto (serviceClient bypassa RLS). Devuelve su id.
  async function seedConcepto(centroId: string, flag: boolean): Promise<string> {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centroId,
        nombre: 'Escolaridad test',
        tipo_concepto: 'mensual',
        activo: true,
        signo: 1,
        ambito: 'nino',
        aplicacion: 'automatico',
        tipo_valor: 'fijo',
        importe_centimos: 10000,
        tarifa_por_anio_nacimiento: flag,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedConcepto: ${error?.message}`)
    return data.id
  }

  // Siembra una tarifa por año (serviceClient bypassa RLS, no los CHECK). Devuelve su id.
  async function seedTarifa(
    centroId: string,
    conceptoId: string,
    anio: number,
    importe: number
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('tarifa_concepto_anio')
      .insert({
        centro_id: centroId,
        concepto_id: conceptoId,
        anio_nacimiento: anio,
        importe_centimos: importe,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seedTarifa: ${error?.message}`)
    return data.id
  }

  async function importeDe(id: string): Promise<number | null> {
    const { data } = await serviceClient
      .from('tarifa_concepto_anio')
      .select('importe_centimos')
      .eq('id', id)
      .maybeSingle()
    return data?.importe_centimos ?? null
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro B1 A')
    centroB = await createTestCentro('Centro B1 B')
    admin = await createTestUser({ nombre: 'Admin B1' })
    profe = await createTestUser({ nombre: 'Profe B1' })
    tutor = await createTestUser({ nombre: 'Tutor B1' })
    outsider = await createTestUser({ nombre: 'Outsider B1' })
    await asignarRol(admin.id, centroA.id, 'admin')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    // outsider sin rol en centroA.
    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
    cTutor = await clientFor(tutor)
    cOutsider = await clientFor(outsider)
    conceptoA = await seedConcepto(centroA.id, true)
    conceptoB = await seedConcepto(centroB.id, true)
  })

  afterAll(async () => {
    await serviceClient.from('tarifa_concepto_anio').delete().eq('centro_id', centroA.id)
    await serviceClient.from('tarifa_concepto_anio').delete().eq('centro_id', centroB.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centroA.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centroB.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
    await deleteTestUser(tutor.id)
    await deleteTestUser(outsider.id)
  })

  it('el admin del centro inserta una tarifa de SU concepto', async () => {
    const { data, error } = await cAdmin
      .from('tarifa_concepto_anio')
      .insert({
        centro_id: centroA.id,
        concepto_id: conceptoA,
        anio_nacimiento: 2024,
        importe_centimos: 50000,
      })
      .select('id, anio_nacimiento, importe_centimos')
      .single()
    expect(error).toBeNull()
    expect(data?.anio_nacimiento).toBe(2024)
    expect(data?.importe_centimos).toBe(50000)
  })

  it('el admin ve la tarifa de su centro; profe/tutor/outsider NO (0 filas)', async () => {
    const id = await seedTarifa(centroA.id, conceptoA, 2025, 45000)
    const { data: vistoAdmin } = await cAdmin.from('tarifa_concepto_anio').select('id').eq('id', id)
    expect(vistoAdmin).toHaveLength(1)
    for (const c of [cProfe, cTutor, cOutsider]) {
      const { data } = await c.from('tarifa_concepto_anio').select('id').eq('id', id)
      expect(data).toHaveLength(0)
    }
  })

  it('un no-admin (profe) NO puede insertar → 42501', async () => {
    const { error } = await cProfe.from('tarifa_concepto_anio').insert({
      centro_id: centroA.id,
      concepto_id: conceptoA,
      anio_nacimiento: 2026,
      importe_centimos: 30000,
    })
    expect(error?.code).toBe('42501')
  })

  it('cruce de centro: admin de A no cuelga una tarifa de un concepto de B (centro_id=A) → 42501', async () => {
    const { error } = await cAdmin.from('tarifa_concepto_anio').insert({
      centro_id: centroA.id,
      concepto_id: conceptoB, // concepto de OTRO centro
      anio_nacimiento: 2024,
      importe_centimos: 10000,
    })
    expect(error?.code).toBe('42501')
  })

  it('cruce de centro: admin de A tampoco con centro_id=B (no es admin de B) → 42501', async () => {
    const { error } = await cAdmin.from('tarifa_concepto_anio').insert({
      centro_id: centroB.id,
      concepto_id: conceptoB,
      anio_nacimiento: 2024,
      importe_centimos: 10000,
    })
    expect(error?.code).toBe('42501')
  })

  it('UNIQUE (concepto, año) rechaza el duplicado → 23505', async () => {
    await seedTarifa(centroA.id, conceptoA, 2027, 20000)
    const { error } = await cAdmin.from('tarifa_concepto_anio').insert({
      centro_id: centroA.id,
      concepto_id: conceptoA,
      anio_nacimiento: 2027, // mismo concepto + año
      importe_centimos: 99999,
    })
    expect(error?.code).toBe('23505')
  })

  it('CHECK importe_centimos >= 0 rechaza negativo → 23514', async () => {
    const { error } = await cAdmin.from('tarifa_concepto_anio').insert({
      centro_id: centroA.id,
      concepto_id: conceptoA,
      anio_nacimiento: 2023,
      importe_centimos: -1,
    })
    expect(error?.code).toBe('23514')
  })

  it('semántica RLS: UPDATE/DELETE de no-admin no afecta filas; la tarifa sobrevive intacta', async () => {
    const id = await seedTarifa(centroA.id, conceptoA, 2022, 40000)
    // UPDATE por profe: USING oculta la fila → 0 filas, sin error.
    const upd = await cProfe
      .from('tarifa_concepto_anio')
      .update({ importe_centimos: 1 })
      .eq('id', id)
      .select('id')
    expect(upd.error).toBeNull()
    expect(upd.data ?? []).toHaveLength(0)
    expect(await importeDe(id)).toBe(40000) // intacta
    // DELETE por tutor: idem.
    const del = await cTutor.from('tarifa_concepto_anio').delete().eq('id', id).select('id')
    expect(del.error).toBeNull()
    expect(del.data ?? []).toHaveLength(0)
    expect(await importeDe(id)).toBe(40000) // sigue ahí
  })
})
