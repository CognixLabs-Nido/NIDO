import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { computarPropuesta } from '@/features/pasar-de-curso/lib/proponer'
import {
  asignarAulaPropuestaCore,
  descartarPropuestaCore,
  marcarFinalizaCore,
} from '@/features/pasar-de-curso/lib/mutaciones-rollover'
import { getEstadoRolloverCore } from '@/features/pasar-de-curso/queries/get-estado-rollover'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
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
 * F-3-A — RLS de `rollover_finaliza` + exclusión mutua pendiente↔finaliza.
 *
 *  1. Admin del centro: INSERT/SELECT/UPDATE/DELETE de su centro (incl. `.insert().select()`
 *     como bloqueo de regresión del gotcha MVCC).
 *  2. profe y tutor: sin acceso (default DENY).
 *  3. Aislamiento entre centros.
 *  4. EXCLUSIÓN MUTUA (la red que sustituye al trigger): marcar Finaliza borra la matrícula
 *     pendiente; asignar aula borra la fila Finaliza. Vía los cores con cliente admin real.
 *  5. `descartarPropuestaCore` borra también las filas Finaliza.
 *  6. `computarPropuesta` no re-propone a los finalizados (van en el set ya-decidido).
 *
 * Gate: F3A_MIGRATION_APPLIED=1 (requiere la migración 20260716120000 aplicada).
 */

const APPLIED = process.env.F3A_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('F-3-A — rollover_finaliza (RLS + exclusión mutua)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoOrigen: { id: string }
  let cursoDestino: { id: string }
  let aulaDestino: { id: string }
  let ninoA: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  let cAdminA: SupabaseClient<Database>
  let cAdminB: SupabaseClient<Database>
  let cProfeA: SupabaseClient<Database>
  let cTutorA: SupabaseClient<Database>

  beforeAll(async () => {
    centroA = await createTestCentro('Centro F3A A')
    centroB = await createTestCentro('Centro F3A B')
    cursoOrigen = await createTestCurso(centroA.id, 'activo')
    cursoDestino = await createTestCurso(centroA.id, 'planificado')
    const aulaOrigen = await createTestAula(centroA.id, cursoOrigen.id, 'Origen')
    aulaDestino = await createTestAula(centroA.id, cursoDestino.id, 'Destino')

    ninoA = await createTestNino(centroA.id, 'Nino F3A')
    await matricular(ninoA.id, aulaOrigen.id, cursoOrigen.id) // activa en origen

    adminA = await createTestUser({ nombre: 'Admin F3A A' })
    adminB = await createTestUser({ nombre: 'Admin F3A B' })
    profeA = await createTestUser({ nombre: 'Profe F3A A' })
    tutorA = await createTestUser({ nombre: 'Tutor F3A A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {})

    cAdminA = await clientFor(adminA)
    cAdminB = await clientFor(adminB)
    cProfeA = await clientFor(profeA)
    cTutorA = await clientFor(tutorA)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('rollover_finaliza').delete().eq('nino_id', ninoA.id)
    await serviceClient.from('matriculas').delete().eq('nino_id', ninoA.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(adminB.id)
    await deleteTestUser(profeA.id)
    await deleteTestUser(tutorA.id)
  }, 60_000)

  it('admin del centro inserta y LEE su fila (.insert().select() — MVCC); centro_id por trigger', async () => {
    const { data, error } = await cAdminA
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
      .select('id, centro_id')
      .single()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.centro_id).toBe(centroA.id) // pasado explícito y derivado por el trigger del curso

    const { data: sel } = await cAdminA
      .from('rollover_finaliza')
      .select('id')
      .eq('nino_id', ninoA.id)
    expect(sel ?? []).toHaveLength(1)

    // Limpieza para los siguientes casos.
    await serviceClient.from('rollover_finaliza').delete().eq('nino_id', ninoA.id)
  })

  it('profe NO accede; tutor NO accede (default DENY)', async () => {
    const profeIns = await cProfeA
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
      .select('id')
      .maybeSingle()
    expect(profeIns.error).not.toBeNull()

    const tutorIns = await cTutorA
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
      .select('id')
      .maybeSingle()
    expect(tutorIns.error).not.toBeNull()

    // Sembramos una fila con service para verificar el SELECT.
    await serviceClient
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
    const profeSel = await cProfeA.from('rollover_finaliza').select('id').eq('nino_id', ninoA.id)
    expect(profeSel.data ?? []).toHaveLength(0)
    const tutorSel = await cTutorA.from('rollover_finaliza').select('id').eq('nino_id', ninoA.id)
    expect(tutorSel.data ?? []).toHaveLength(0)

    await serviceClient.from('rollover_finaliza').delete().eq('nino_id', ninoA.id)
  })

  it('aislamiento entre centros: admin de otro centro no ve ni inserta', async () => {
    await serviceClient
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
    const sel = await cAdminB.from('rollover_finaliza').select('id').eq('nino_id', ninoA.id)
    expect(sel.data ?? []).toHaveLength(0)

    const ins = await cAdminB
      .from('rollover_finaliza')
      .insert({ centro_id: centroA.id, curso_academico_id: cursoDestino.id, nino_id: ninoA.id })
      .select('id')
      .maybeSingle()
    expect(ins.error).not.toBeNull() // WITH CHECK es_admin(centroA) → false para adminB

    await serviceClient.from('rollover_finaliza').delete().eq('nino_id', ninoA.id)
  })

  it('EXCLUSIÓN MUTUA: marcar Finaliza borra la pendiente; asignar aula borra la Finaliza', async () => {
    // Partimos de una propuesta de aula (pendiente).
    const asig = await asignarAulaPropuestaCore(cAdminA, cursoDestino.id, ninoA.id, aulaDestino.id)
    expect(asig.success).toBe(true)
    let pend = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('nino_id', ninoA.id)
      .eq('curso_academico_id', cursoDestino.id)
      .eq('estado', 'pendiente')
    expect(pend.data ?? []).toHaveLength(1)

    // Marcar Finaliza → borra la pendiente, crea la fila finaliza.
    const fin = await marcarFinalizaCore(cAdminA, cursoDestino.id, ninoA.id)
    expect(fin.success).toBe(true)
    pend = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('nino_id', ninoA.id)
      .eq('curso_academico_id', cursoDestino.id)
      .eq('estado', 'pendiente')
    expect(pend.data ?? []).toHaveLength(0)
    let finRows = await serviceClient.from('rollover_finaliza').select('id').eq('nino_id', ninoA.id)
    expect(finRows.data ?? []).toHaveLength(1)

    // Asignar aula → borra la fila finaliza, recrea la pendiente.
    const asig2 = await asignarAulaPropuestaCore(cAdminA, cursoDestino.id, ninoA.id, aulaDestino.id)
    expect(asig2.success).toBe(true)
    finRows = await serviceClient.from('rollover_finaliza').select('id').eq('nino_id', ninoA.id)
    expect(finRows.data ?? []).toHaveLength(0)
    pend = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('nino_id', ninoA.id)
      .eq('curso_academico_id', cursoDestino.id)
      .eq('estado', 'pendiente')
    expect(pend.data ?? []).toHaveLength(1)
  })

  it('descartarPropuestaCore borra pendientes Y filas Finaliza', async () => {
    await marcarFinalizaCore(cAdminA, cursoDestino.id, ninoA.id) // deja finaliza (borra pendiente)
    const r = await descartarPropuestaCore(cAdminA, cursoDestino.id)
    expect(r.success).toBe(true)
    const finRows = await serviceClient
      .from('rollover_finaliza')
      .select('id')
      .eq('curso_academico_id', cursoDestino.id)
    expect(finRows.data ?? []).toHaveLength(0)
    const pend = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('curso_academico_id', cursoDestino.id)
      .eq('estado', 'pendiente')
    expect(pend.data ?? []).toHaveLength(0)
  })

  it('proponer no re-propone a los finalizados (van en el set ya-decidido)', async () => {
    await marcarFinalizaCore(cAdminA, cursoDestino.id, ninoA.id)
    const estado = await getEstadoRolloverCore(cAdminA, cursoDestino.id)
    expect(estado).not.toBeNull()
    expect(estado!.finalizados).toContain(ninoA.id)

    const yaDecidido = new Set([
      ...estado!.pendientes.map((p) => p.nino_id),
      ...estado!.finalizados,
    ])
    const resultado = computarPropuesta(estado!.ninosActivos, estado!.aulasDestino, yaDecidido)
    expect(resultado.propuestas.map((p) => p.nino_id)).not.toContain(ninoA.id)

    await serviceClient.from('rollover_finaliza').delete().eq('nino_id', ninoA.id)
  })
})
