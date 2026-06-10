import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS + integridad de `campanas_informe` (F9-5-0). **Gated** por
 * `F9_5_0_MIGRATION_APPLIED=1`: la migración
 * `20260610140000_phase9_5_0_campanas_informe.sql` se aplica manualmente vía Supabase
 * SQL Editor (CLI con bug SIGILL). Hasta entonces estos tests se omiten.
 *
 * Comando tras aplicar la migración:
 *   F9_5_0_MIGRATION_APPLIED=1 npm run test:rls -- campanas-informe.rls
 *
 * Cubre (spec docs/specs/campana-informes.md, ADR-0044):
 *  - admin abre (.insert().select() — MVCC), cierra y reabre la campaña; edita fecha.
 *  - staff del centro (profe) LEE pero NO escribe; familia/otro centro NO leen.
 *  - UNIQUE por (centro, curso, período); varias campañas de períodos distintos sí.
 *  - DELETE bloqueado (default DENY) — cerrar = UPDATE.
 */
const MIGRATION_APPLIED = process.env.F9_5_0_MIGRATION_APPLIED === '1'

type CampanaInsert = Database['public']['Tables']['campanas_informe']['Insert']

describe.skipIf(!MIGRATION_APPLIED)('RLS campañas de informe — F9-5-0', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let cursoB: { id: string }

  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let adminB: TestUser

  const campanasCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Campaña')
    centroB = await createTestCentro('Centro Campaña B')
    curso = await createTestCurso(centro.id)
    cursoB = await createTestCurso(centroB.id)
    // Un aula con la profe asignada para que `es_profe_en_centro` sea TRUE.
    const aula = await createTestAula(centro.id, curso.id, 'Aula Campaña')

    admin = await createTestUser({ nombre: 'Admin Camp' })
    profe = await createTestUser({ nombre: 'Profe Camp' })
    tutor = await createTestUser({ nombre: 'Tutor Camp' })
    adminB = await createTestUser({ nombre: 'Admin Camp B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(adminB.id, centroB.id, 'admin')

    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id: profe.id,
      aula_id: aula.id,
      fecha_inicio: '2026-09-01',
      tipo_personal_aula: 'profesora',
    })
    if (error) throw new Error(`asignar profe falló: ${error.message}`)
  })

  afterAll(async () => {
    for (const id of campanasCreadas)
      await serviceClient.from('campanas_informe').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, profe, tutor, adminB]) await deleteTestUser(u.id)
  })

  function payload(over: Partial<CampanaInsert> = {}): CampanaInsert {
    return {
      centro_id: centro.id,
      curso_academico_id: curso.id,
      periodo: 'trimestre_1',
      fecha_limite: '2026-12-20',
      created_by: admin.id,
      ...over,
    }
  }

  it('admin abre campaña (.insert().select() — MVCC), la cierra y la reabre', async () => {
    const c = await clientFor(admin)
    const ins = await c
      .from('campanas_informe')
      .insert(payload())
      .select('id, estado')
      .maybeSingle()
    expect(ins.error).toBeNull()
    expect(ins.data?.id).toBeTruthy()
    expect(ins.data?.estado).toBe('abierta')
    if (ins.data?.id) campanasCreadas.push(ins.data.id)

    // Cerrar (UPDATE estado).
    const cerrar = await c
      .from('campanas_informe')
      .update({ estado: 'cerrada' })
      .eq('id', ins.data!.id)
      .select('estado')
      .maybeSingle()
    expect(cerrar.error).toBeNull()
    expect(cerrar.data?.estado).toBe('cerrada')

    // Reabrir + editar fecha (Q4: reversible, fecha editable).
    const reabrir = await c
      .from('campanas_informe')
      .update({ estado: 'abierta', fecha_limite: '2027-01-15' })
      .eq('id', ins.data!.id)
      .select('estado, fecha_limite')
      .maybeSingle()
    expect(reabrir.error).toBeNull()
    expect(reabrir.data?.estado).toBe('abierta')
    expect(reabrir.data?.fecha_limite).toBe('2027-01-15')
  })

  it('profe del centro LEE la campaña pero NO puede crearla', async () => {
    // Semilla con service role.
    const seed = await serviceClient
      .from('campanas_informe')
      .insert(payload({ periodo: 'trimestre_2' }))
      .select('id')
      .single()
    if (seed.error || !seed.data) throw new Error(`seed falló: ${seed.error?.message}`)
    campanasCreadas.push(seed.data.id)

    const cProfe = await clientFor(profe)
    // Lee.
    expect(
      (await cProfe.from('campanas_informe').select('id').eq('id', seed.data.id)).data?.length
    ).toBe(1)
    // No crea (42501 / 0 filas).
    const intento = await cProfe
      .from('campanas_informe')
      .insert(payload({ periodo: 'trimestre_3', created_by: profe.id }))
      .select('id')
      .maybeSingle()
    expect(intento.data).toBeNull()
    expect(intento.error).not.toBeNull()
  })

  it('profe NO puede cerrar/editar una campaña (solo lee)', async () => {
    const seed = await serviceClient
      .from('campanas_informe')
      .insert(payload({ periodo: 'fin_curso' }))
      .select('id')
      .single()
    if (seed.error || !seed.data) throw new Error(`seed falló: ${seed.error?.message}`)
    campanasCreadas.push(seed.data.id)

    const cProfe = await clientFor(profe)
    const intento = await cProfe
      .from('campanas_informe')
      .update({ estado: 'cerrada' })
      .eq('id', seed.data.id)
      .select('id')
      .maybeSingle()
    expect(intento.data).toBeNull() // USING falso → 0 filas
    // Sigue abierta (service role lo confirma).
    const check = await serviceClient
      .from('campanas_informe')
      .select('estado')
      .eq('id', seed.data.id)
      .single()
    expect(check.data?.estado).toBe('abierta')
  })

  it('familia (tutor) NO ve campañas; admin de otro centro tampoco (aislamiento)', async () => {
    const seed = await serviceClient
      .from('campanas_informe')
      .insert(
        payload({
          curso_academico_id: curso.id,
          periodo: 'trimestre_1',
          fecha_limite: '2026-11-30',
        })
      )
      .select('id')
      .maybeSingle()
    // Puede chocar con el UNIQUE si ya existe trimestre_1 del primer test; usamos uno nuevo si hace falta.
    let campanaId = seed.data?.id
    if (!campanaId) {
      // Ya existe trimestre_1 (terna única): reusa el existente del centro/curso.
      const existente = await serviceClient
        .from('campanas_informe')
        .select('id')
        .eq('centro_id', centro.id)
        .eq('curso_academico_id', curso.id)
        .eq('periodo', 'trimestre_1')
        .single()
      campanaId = existente.data!.id
    } else {
      campanasCreadas.push(campanaId)
    }

    const cTutor = await clientFor(tutor)
    expect(
      (await cTutor.from('campanas_informe').select('id').eq('id', campanaId!)).data?.length ?? 0
    ).toBe(0)

    const cAdminB = await clientFor(adminB)
    expect(
      (await cAdminB.from('campanas_informe').select('id').eq('id', campanaId!)).data?.length ?? 0
    ).toBe(0)
  })

  it('UNIQUE por (centro, curso, período): no se duplica la misma terna', async () => {
    const c = await clientFor(admin)
    // trimestre_2 ya fue sembrado en un test anterior con service role.
    const dup = await c
      .from('campanas_informe')
      .insert(payload({ periodo: 'trimestre_2' }))
      .select('id')
      .maybeSingle()
    expect(dup.error).not.toBeNull() // 23505 unique_violation
  })

  it('DELETE bloqueado para todos (incluido admin)', async () => {
    const seed = await serviceClient
      .from('campanas_informe')
      .insert(
        payload({ curso_academico_id: cursoB.id, centro_id: centroB.id, created_by: adminB.id })
      )
      .select('id')
      .single()
    if (seed.error || !seed.data) throw new Error(`seed falló: ${seed.error?.message}`)
    campanasCreadas.push(seed.data.id)

    const cAdminB = await clientFor(adminB)
    await cAdminB.from('campanas_informe').delete().eq('id', seed.data.id)
    const sigue = await serviceClient.from('campanas_informe').select('id').eq('id', seed.data.id)
    expect(sigue.data?.length).toBe(1) // default DENY → no se borró
  })
})
