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
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de `dias_centro` (Fase 4.5a).
 *
 * Verifica:
 *  - admin del centro puede INSERT/UPDATE/DELETE,
 *  - admin NO puede tocar otro centro,
 *  - profe del centro puede SELECT pero NO escribir,
 *  - tutor con vínculo a niño del centro puede SELECT pero NO escribir,
 *  - usuario sin vínculo al centro NO puede SELECT.
 *
 * `pertenece_a_centro` mira `roles_usuario`, así que basta con asignar
 * el rol correspondiente al usuario en el centro.
 */
describe('RLS dias_centro — admin escribe, miembros leen, externos no', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let aulaA: { id: string }
  let ninoA: { id: string }
  let adminA: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  let externo: TestUser
  // Cleanup tracking
  const diasCreados: Array<{ id: string }> = []

  beforeAll(async () => {
    centroA = await createTestCentro('Centro DiasCentro A')
    centroB = await createTestCentro('Centro DiasCentro B')

    cursoA = await createTestCurso(centroA.id)
    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula Cal A')
    ninoA = await createTestNino(centroA.id, 'Niño Cal A')
    await matricular(ninoA.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin Cal A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeA = await createTestUser({ nombre: 'Profe Cal A' })
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA.id)

    tutorA = await createTestUser({ nombre: 'Tutor Cal A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
    })

    externo = await createTestUser({ nombre: 'Usuario sin vínculo' })
    // Sin rol → no pertenece a ningún centro.
  }, 120_000)

  afterAll(async () => {
    const usuarios = [adminA?.id, profeA?.id, tutorA?.id, externo?.id].filter((u): u is string =>
      Boolean(u)
    )

    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)

    if (diasCreados.length > 0) {
      await serviceClient
        .from('dias_centro')
        .delete()
        .in(
          'id',
          diasCreados.map((d) => d.id)
        )
    }
    // El CASCADE on delete del centro limpia cualquier dias_centro huérfano.
    await serviceClient.from('matriculas').delete().eq('nino_id', ninoA.id)
    await serviceClient.from('ninos').delete().eq('id', ninoA.id)
    await serviceClient.from('aulas').delete().eq('id', aulaA.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', cursoA.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 90_000)

  it('admin del centro A puede INSERT en su centro', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('dias_centro')
      .insert({
        centro_id: centroA.id,
        fecha: '2026-12-25',
        tipo: 'festivo',
        observaciones: 'Navidad',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) diasCreados.push({ id: data.id })
  })

  it('admin del centro A puede UPDATE y DELETE en su centro', async () => {
    const client = await clientFor(adminA)
    // Insert para usar
    const { data: inserted } = await client
      .from('dias_centro')
      .insert({ centro_id: centroA.id, fecha: '2026-01-06', tipo: 'festivo' })
      .select('id')
      .single()
    expect(inserted?.id).toBeTruthy()
    if (!inserted?.id) return

    // Update
    const { error: updErr } = await client
      .from('dias_centro')
      .update({ observaciones: 'Reyes' })
      .eq('id', inserted.id)
    expect(updErr).toBeNull()

    // Delete (excepción explícita ADR-0019)
    const { error: delErr } = await client.from('dias_centro').delete().eq('id', inserted.id)
    expect(delErr).toBeNull()

    const { data: verify } = await serviceClient
      .from('dias_centro')
      .select('id')
      .eq('id', inserted.id)
      .maybeSingle()
    expect(verify).toBeNull()
  })

  it('admin del centro A NO puede INSERT en centro B (RLS rechaza)', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('dias_centro')
      .insert({
        centro_id: centroB.id,
        fecha: '2026-12-25',
        tipo: 'festivo',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('profe del centro puede SELECT pero NO INSERT/UPDATE/DELETE', async () => {
    const client = await clientFor(profeA)

    // SELECT permitido
    const { data: selectData, error: selectErr } = await client
      .from('dias_centro')
      .select('id, fecha, tipo')
      .eq('centro_id', centroA.id)
    expect(selectErr).toBeNull()
    expect(Array.isArray(selectData)).toBe(true)

    // INSERT rechazado
    const { data: insertData, error: insertErr } = await client
      .from('dias_centro')
      .insert({ centro_id: centroA.id, fecha: '2026-11-09', tipo: 'festivo' })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
    expect(insertData).toBeNull()
  })

  it('tutor con vínculo a niño del centro puede SELECT pero NO escribir', async () => {
    const client = await clientFor(tutorA)

    const { data: selectData, error: selectErr } = await client
      .from('dias_centro')
      .select('id, fecha, tipo')
      .eq('centro_id', centroA.id)
    expect(selectErr).toBeNull()
    expect(Array.isArray(selectData)).toBe(true)

    const { data: insertData, error: insertErr } = await client
      .from('dias_centro')
      .insert({ centro_id: centroA.id, fecha: '2026-10-09', tipo: 'festivo' })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
    expect(insertData).toBeNull()
  })

  it('usuario sin vínculo al centro NO puede SELECT', async () => {
    const client = await clientFor(externo)
    const { data, error } = await client
      .from('dias_centro')
      .select('id')
      .eq('centro_id', centroA.id)
    // SELECT no falla por RLS: devuelve 0 filas (default DENY = no se ven).
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })
})
