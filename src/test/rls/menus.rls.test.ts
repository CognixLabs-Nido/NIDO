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
 * RLS de `plantillas_menu` y `plantilla_menu_dia` (Fase 4.5).
 *
 * Cubre:
 *  - aislamiento entre centros (admin A no ve plantillas de B).
 *  - admin de centro A no puede crear plantilla apuntando a centro B
 *    (CHECK de INSERT con `centro_id`).
 *  - profe del centro puede leer plantillas pero NO modificarlas.
 *  - tutor del centro puede leer plantillas.
 *  - DELETE bloqueado a todos (default DENY).
 *  - `plantilla_menu_dia` hereda permisos vía `centro_de_plantilla()`.
 */

describe('RLS plantillas_menu — aislamiento, permisos, default deny delete', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let aulaA: { id: string }
  let ninoA: { id: string }
  let plantillaA: { id: string }
  let plantillaB: { id: string }
  let plantillaDiaA: { id: string }

  let adminA: TestUser
  let adminB: TestUser
  let profeA: TestUser
  let tutorA: TestUser

  const usuariosCreados: string[] = []

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Menus A')
    centroB = await createTestCentro('Centro Menus B')

    cursoA = await createTestCurso(centroA.id)
    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula Menus A')
    ninoA = await createTestNino(centroA.id, 'Niño Menus A')
    await matricular(ninoA.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin Menus A' })
    usuariosCreados.push(adminA.id)
    await asignarRol(adminA.id, centroA.id, 'admin')

    adminB = await createTestUser({ nombre: 'Admin Menus B' })
    usuariosCreados.push(adminB.id)
    await asignarRol(adminB.id, centroB.id, 'admin')

    profeA = await createTestUser({ nombre: 'Profe Menus A' })
    usuariosCreados.push(profeA.id)
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA.id)

    tutorA = await createTestUser({ nombre: 'Tutor Menus A' })
    usuariosCreados.push(tutorA.id)
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
    })

    // Sembrar 1 plantilla en cada centro vía service_role (bypass RLS).
    const insA = await serviceClient
      .from('plantillas_menu')
      .insert({
        centro_id: centroA.id,
        nombre: 'Plantilla A — semana 1',
        estado: 'borrador',
      })
      .select('id')
      .single()
    if (insA.error || !insA.data) throw new Error(`seed A failed: ${insA.error?.message}`)
    plantillaA = { id: insA.data.id }

    const insB = await serviceClient
      .from('plantillas_menu')
      .insert({
        centro_id: centroB.id,
        nombre: 'Plantilla B — semana 1',
        estado: 'borrador',
      })
      .select('id')
      .single()
    if (insB.error || !insB.data) throw new Error(`seed B failed: ${insB.error?.message}`)
    plantillaB = { id: insB.data.id }

    const insDia = await serviceClient
      .from('plantilla_menu_dia')
      .insert({
        plantilla_id: plantillaA.id,
        dia_semana: 'lunes',
        desayuno: 'Tostadas con tomate',
        media_manana: 'Fruta',
        comida: 'Lentejas',
        merienda: 'Yogur',
      })
      .select('id')
      .single()
    if (insDia.error || !insDia.data) throw new Error(`seed dia failed: ${insDia.error?.message}`)
    plantillaDiaA = { id: insDia.data.id }
  }, 60_000)

  afterAll(async () => {
    // Hard delete via service_role.
    await serviceClient.from('plantilla_menu_dia').delete().eq('plantilla_id', plantillaA.id)
    await serviceClient.from('plantillas_menu').delete().in('id', [plantillaA.id, plantillaB.id])
    for (const id of usuariosCreados) await deleteTestUser(id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 60_000)

  it('admin de centro A ve la plantilla de A pero NO la de B', async () => {
    const c = await clientFor(adminA)
    const { data, error } = await c.from('plantillas_menu').select('id, centro_id, nombre')
    expect(error).toBeNull()
    expect(data).toBeDefined()
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(plantillaA.id)
    expect(ids).not.toContain(plantillaB.id)
  })

  it('admin de centro A NO puede crear plantilla apuntando a centro B', async () => {
    const c = await clientFor(adminA)
    const { error } = await c
      .from('plantillas_menu')
      .insert({ centro_id: centroB.id, nombre: 'Crackeada' })
    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.includes('row-level security')).toBe(true)
  })

  it('profe del centro A lee plantillas del centro A', async () => {
    const c = await clientFor(profeA)
    const { data, error } = await c.from('plantillas_menu').select('id').eq('id', plantillaA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
  })

  it('profe NO puede crear plantillas', async () => {
    const c = await clientFor(profeA)
    const { error } = await c
      .from('plantillas_menu')
      .insert({ centro_id: centroA.id, nombre: 'Profe lo intenta' })
    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.includes('row-level security')).toBe(true)
  })

  it('profe NO puede actualizar plantillas (cambiar estado a publicada)', async () => {
    const c = await clientFor(profeA)
    const { error } = await c
      .from('plantillas_menu')
      .update({ estado: 'publicada' })
      .eq('id', plantillaA.id)
    // RLS sobre UPDATE rechaza explícitamente, o devuelve 0 filas. Verificamos
    // que NO acabe en estado publicada releyendo desde service.
    expect(
      error?.code === '42501' || error === null || error?.message.includes('row-level security')
    ).toBe(true)
    const reread = await serviceClient
      .from('plantillas_menu')
      .select('estado')
      .eq('id', plantillaA.id)
      .single()
    expect(reread.data?.estado).toBe('borrador')
  })

  it('tutor del centro A lee plantillas del centro A', async () => {
    const c = await clientFor(tutorA)
    const { data, error } = await c.from('plantillas_menu').select('id').eq('id', plantillaA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
  })

  it('admin de centro B NO ve plantillas de centro A', async () => {
    const c = await clientFor(adminB)
    const { data } = await c.from('plantillas_menu').select('id').eq('id', plantillaA.id)
    expect(data?.length ?? 0).toBe(0)
  })

  it('DELETE en plantillas_menu rechazado a admin (default DENY)', async () => {
    const c = await clientFor(adminA)
    const { error } = await c.from('plantillas_menu').delete().eq('id', plantillaA.id)
    // Sin policy DELETE, RLS rechaza con 42501 o devuelve 0 filas borradas.
    // Reconfirmamos via service que la plantilla sigue ahí.
    const reread = await serviceClient
      .from('plantillas_menu')
      .select('id')
      .eq('id', plantillaA.id)
      .single()
    expect(reread.data?.id).toBe(plantillaA.id)
    // El error puede ser null si Postgres considera "0 filas afectadas" como
    // success silencioso bajo RLS DENY — la verificación real es que la
    // fila sigue existiendo.
    void error
  })

  it('plantilla_menu_dia hereda permisos: profe lee, admin de otro centro no lee', async () => {
    const profeClient = await clientFor(profeA)
    const adminBClient = await clientFor(adminB)

    const { data: profeRead } = await profeClient
      .from('plantilla_menu_dia')
      .select('id')
      .eq('id', plantillaDiaA.id)
    expect(profeRead?.length).toBe(1)

    const { data: adminBRead } = await adminBClient
      .from('plantilla_menu_dia')
      .select('id')
      .eq('id', plantillaDiaA.id)
    expect(adminBRead?.length ?? 0).toBe(0)
  })

  it('plantilla_menu_dia: profe NO puede UPDATE', async () => {
    const c = await clientFor(profeA)
    const { error } = await c
      .from('plantilla_menu_dia')
      .update({ desayuno: 'Hack' })
      .eq('id', plantillaDiaA.id)
    void error
    const reread = await serviceClient
      .from('plantilla_menu_dia')
      .select('desayuno')
      .eq('id', plantillaDiaA.id)
      .single()
    expect(reread.data?.desayuno).toBe('Tostadas con tomate')
  })

  it('plantilla_menu_dia: admin del centro SÍ puede UPDATE', async () => {
    const c = await clientFor(adminA)
    const { error } = await c
      .from('plantilla_menu_dia')
      .update({ comida: 'Garbanzos' })
      .eq('id', plantillaDiaA.id)
    expect(error).toBeNull()
    const reread = await serviceClient
      .from('plantilla_menu_dia')
      .select('comida')
      .eq('id', plantillaDiaA.id)
      .single()
    expect(reread.data?.comida).toBe('Garbanzos')
  })

  it('admin del centro SÍ puede publicar (UPDATE estado)', async () => {
    const c = await clientFor(adminA)
    const { error } = await c
      .from('plantillas_menu')
      .update({ estado: 'publicada' })
      .eq('id', plantillaA.id)
    expect(error).toBeNull()
    const reread = await serviceClient
      .from('plantillas_menu')
      .select('estado')
      .eq('id', plantillaA.id)
      .single()
    expect(reread.data?.estado).toBe('publicada')
  })
})
