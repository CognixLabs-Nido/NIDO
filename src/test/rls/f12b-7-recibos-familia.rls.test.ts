import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F12-B-7 — Visibilidad de recibos para la familia (el test que quedó pendiente en B-7).
 *
 * A diferencia del test de B-0 (que aísla entre CENTROS distintos), aquí las DOS familias
 * están en el MISMO centro para verificar el corte fino: un tutor ve el recibo y el
 * desglose de SU hijo, pero NO el del otro niño del mismo centro (otra familia). El admin
 * ve TODOS los recibos del centro; la profe del aula NO ve recibos (control económico).
 *
 * Gateado: F12B_RLS_APPLIED=1 (RLS de recibos/lineas_recibo de la migración phase12b_0,
 * ya aplicada). Reusa la RLS existente (es_tutor_legal_de / es_admin), sin esquema nuevo.
 */

const APPLIED = process.env.F12B_RLS_APPLIED === '1'

describe.skipIf(!APPLIED)('F12-B-7 — recibos: aislamiento entre familias del MISMO centro', () => {
  let centro: { id: string }
  let nino1: { id: string; familia_id: string } // tutela de tutor1
  let nino2: { id: string; familia_id: string } // tutela de tutor2 (misma aula, mismo centro)
  let admin: TestUser
  let profe: TestUser
  let tutor1: TestUser
  let tutor2: TestUser
  let cAdmin: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  let cTutor1: SupabaseClient<Database>
  let recibo1: string
  let recibo2: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro F12B7')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)

    nino1 = await createTestNino(centro.id, 'Nino 1 F12B7')
    nino2 = await createTestNino(centro.id, 'Nino 2 F12B7')
    await matricular(nino1.id, aula.id, curso.id)
    await matricular(nino2.id, aula.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin F12B7' })
    profe = await createTestUser({ nombre: 'Profe F12B7' })
    tutor1 = await createTestUser({ nombre: 'Tutor 1 F12B7' })
    tutor2 = await createTestUser({ nombre: 'Tutor 2 F12B7' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    await crearVinculo(nino1.id, tutor1.id, 'tutor_legal_principal', {})
    await crearVinculo(nino2.id, tutor2.id, 'tutor_legal_principal', {})
    // F-4-1: la RLS de recibos pasa a es_tutor_de_familia → el tutor debe estar en familia_tutores.
    await crearFamiliaTutor(nino1.familia_id, tutor1.id, 'titular')
    await crearFamiliaTutor(nino2.familia_id, tutor2.id, 'titular')

    cAdmin = await clientFor(admin)
    cProfe = await clientFor(profe)
    cTutor1 = await clientFor(tutor1)

    // Recibo + línea de cada niño (mes abierto: pasa el trigger de congelado).
    for (const [ninoId, familiaId, total, ref] of [
      [nino1.id, nino1.familia_id, 8000, 'r1'],
      [nino2.id, nino2.familia_id, 6000, 'r2'],
    ] as const) {
      const { data: r } = await serviceClient
        .from('recibos')
        .insert({
          centro_id: centro.id,
          familia_id: familiaId, // F-4-1: recibos a grano familia
          nino_id: ninoId,
          anio: 2026,
          mes: 5,
          metodo: 'sepa',
          total_centimos: total,
          es_esporadico: false,
        })
        .select('id')
        .single()
      if (ref === 'r1') recibo1 = r!.id
      else recibo2 = r!.id
      await serviceClient.from('lineas_recibo').insert({
        centro_id: centro.id,
        recibo_id: r!.id,
        descripcion: 'Comedor',
        cantidad: 1,
        precio_unitario_centimos: total,
        importe_centimos: total,
      })
    }
  })

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(profe.id)
    await deleteTestUser(tutor1.id)
    await deleteTestUser(tutor2.id)
    await deleteTestCentro(centro.id)
  })

  it('el tutor ve SOLO el recibo de su hijo, no el del otro niño del mismo centro', async () => {
    const { data } = await cTutor1.from('recibos').select('id, nino_id').eq('centro_id', centro.id)
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(recibo1)
    expect(ids).not.toContain(recibo2)
    expect(ids).toHaveLength(1)
  })

  it('el tutor ve SOLO el desglose (lineas) de su hijo, no el del otro niño', async () => {
    const propio = await cTutor1.from('lineas_recibo').select('id').eq('recibo_id', recibo1)
    expect(propio.data ?? []).toHaveLength(1)
    const ajeno = await cTutor1.from('lineas_recibo').select('id').eq('recibo_id', recibo2)
    expect(ajeno.data ?? []).toHaveLength(0)
  })

  it('el admin ve TODOS los recibos del centro (ambos niños)', async () => {
    const { data } = await cAdmin.from('recibos').select('id').eq('centro_id', centro.id)
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(recibo1)
    expect(ids).toContain(recibo2)
  })

  it('la profe del aula NO ve recibos (control económico admin-only)', async () => {
    const { data } = await cProfe.from('recibos').select('id').eq('centro_id', centro.id)
    expect(data ?? []).toHaveLength(0)
  })
})
