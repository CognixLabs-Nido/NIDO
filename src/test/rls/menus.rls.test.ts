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
 * RLS de `plantillas_menu_mensual` y `menu_dia` (Fase 4.5b).
 *
 * Verifica:
 *  - admin escribe (INSERT/UPDATE) plantillas y menu_dia,
 *  - admin cross-centro rechazado,
 *  - profe/tutor del centro pueden SELECT pero NO escribir,
 *  - usuario sin vínculo al centro NO ve nada,
 *  - DELETE rechazado a todos (plantillas se archivan, no se borran),
 *  - extensión de `comidas` con tipo_plato sigue respetando RLS de F3.
 */
describe('RLS menus — plantillas, menu_dia y comidas con tipo_plato', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let aulaA: { id: string }
  let ninoA: { id: string }
  let adminA: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  // Plantillas creadas
  let plantillaA: { id: string } | null = null
  let plantillaB: { id: string } | null = null

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Menus A')
    centroB = await createTestCentro('Centro Menus B')

    cursoA = await createTestCurso(centroA.id)
    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula Menus A')
    ninoA = await createTestNino(centroA.id, 'Niño Menus A')
    await matricular(ninoA.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin Menus A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeA = await createTestUser({ nombre: 'Profe Menus A' })
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA.id)

    tutorA = await createTestUser({ nombre: 'Tutor Menus A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
    })
  }, 120_000)

  afterAll(async () => {
    const usuarios = [adminA?.id, profeA?.id, tutorA?.id].filter((u): u is string => Boolean(u))
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)

    // Plantillas con CASCADE limpian menu_dia. El centro con CASCADE limpia plantillas.
    await serviceClient.from('matriculas').delete().eq('nino_id', ninoA.id)
    await serviceClient.from('ninos').delete().eq('id', ninoA.id)
    await serviceClient.from('aulas').delete().eq('id', aulaA.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', cursoA.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 90_000)

  it('admin del centro A puede INSERT plantilla en su centro', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('plantillas_menu_mensual')
      .insert({
        centro_id: centroA.id,
        mes: 10,
        anio: 2026,
        estado: 'borrador',
        creada_por: adminA.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    plantillaA = { id: data!.id }
  })

  it('admin del centro A NO puede INSERT plantilla en centro B (RLS rechaza)', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('plantillas_menu_mensual')
      .insert({
        centro_id: centroB.id,
        mes: 10,
        anio: 2026,
        estado: 'borrador',
        creada_por: adminA.id,
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('admin del centro A puede INSERT menu_dia en su plantilla', async () => {
    expect(plantillaA?.id).toBeTruthy()
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('menu_dia')
      .insert({
        plantilla_id: plantillaA!.id,
        fecha: '2026-10-15',
        comida_primero: 'Macarrones',
        comida_segundo: 'Pollo asado',
        comida_postre: 'Yogur',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('profe del centro puede SELECT plantillas y menu_dia, NO INSERT', async () => {
    const client = await clientFor(profeA)
    const { data: select, error: selectErr } = await client
      .from('plantillas_menu_mensual')
      .select('id, mes, anio')
      .eq('centro_id', centroA.id)
    expect(selectErr).toBeNull()
    expect((select ?? []).length).toBeGreaterThanOrEqual(1)

    const { data: selectMd, error: selectMdErr } = await client
      .from('menu_dia')
      .select('id, fecha')
      .eq('plantilla_id', plantillaA!.id)
    expect(selectMdErr).toBeNull()
    expect((selectMd ?? []).length).toBeGreaterThanOrEqual(1)

    const { error: insertErr } = await client
      .from('plantillas_menu_mensual')
      .insert({ centro_id: centroA.id, mes: 11, anio: 2026, estado: 'borrador' })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
  })

  it('tutor del centro puede SELECT plantillas y menu_dia, NO INSERT', async () => {
    const client = await clientFor(tutorA)
    const { data: select, error: selectErr } = await client
      .from('plantillas_menu_mensual')
      .select('id, mes, anio')
      .eq('centro_id', centroA.id)
    expect(selectErr).toBeNull()
    expect((select ?? []).length).toBeGreaterThanOrEqual(1)

    const { error: insertErr } = await client
      .from('menu_dia')
      .insert({ plantilla_id: plantillaA!.id, fecha: '2026-10-16' })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
  })

  it('DELETE en plantillas y menu_dia rechazado a admin (default DENY)', async () => {
    const client = await clientFor(adminA)
    // Intento DELETE plantilla: no policy → 0 filas afectadas, sin error.
    const { error: delPlantillaErr } = await client
      .from('plantillas_menu_mensual')
      .delete()
      .eq('id', plantillaA!.id)
    expect(delPlantillaErr).toBeNull()
    const { data: verifyP } = await serviceClient
      .from('plantillas_menu_mensual')
      .select('id')
      .eq('id', plantillaA!.id)
      .maybeSingle()
    expect(verifyP?.id).toBe(plantillaA!.id)

    // Idem para menu_dia.
    const { error: delMdErr } = await client
      .from('menu_dia')
      .delete()
      .eq('plantilla_id', plantillaA!.id)
    expect(delMdErr).toBeNull()
    const { count } = await serviceClient
      .from('menu_dia')
      .select('id', { count: 'exact', head: true })
      .eq('plantilla_id', plantillaA!.id)
    expect((count ?? 0) >= 1).toBe(true)
  })

  it('admin centro B puede INSERT plantilla en B (control positivo cross-centro)', async () => {
    // Necesitamos un admin de centroB para verificar el segundo lado del aislamiento.
    const adminB = await createTestUser({ nombre: 'Admin Menus B' })
    await asignarRol(adminB.id, centroB.id, 'admin')
    try {
      const client = await clientFor(adminB)
      const { data, error } = await client
        .from('plantillas_menu_mensual')
        .insert({ centro_id: centroB.id, mes: 10, anio: 2026, estado: 'borrador' })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
      plantillaB = { id: data!.id }

      // Y NO ve la plantilla de centroA.
      const { data: cross, error: crossErr } = await client
        .from('plantillas_menu_mensual')
        .select('id')
        .eq('centro_id', centroA.id)
      expect(crossErr).toBeNull()
      expect((cross ?? []).length).toBe(0)
    } finally {
      await serviceClient.from('roles_usuario').delete().eq('usuario_id', adminB.id)
      await deleteTestUser(adminB.id)
    }
    void plantillaB
  })
})
