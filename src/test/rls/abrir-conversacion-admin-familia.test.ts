import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { abrirConversacionAdminFamiliaCore } from '@/features/messaging/actions/abrir-conversacion-admin-familia'

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
 * Tests del server action `abrirConversacionAdminFamiliaCore` (Fase 5.6-A C1).
 *
 * Se prueba el "core" (cliente Supabase + userId inyectados) para poder
 * ejercer el flujo extremo a extremo contra el remoto sin atravesar el
 * runtime de Next.js / cookies. El wrapper público `abrirConversacionAdminFamilia`
 * solo añade resolución de sesión + `revalidatePath`, sin lógica adicional.
 *
 * 4 escenarios canónicos:
 *  1. Admin crea hilo nuevo → INSERT, expires_at ≈ now()+3d.
 *  2. Admin reabre hilo existente → UPDATE solo de expires_at; admin_id,
 *     tutor_id y centro_id intactos.
 *  3. Admin de otro centro rechazado con `tutor_no_pertenece_centro`.
 *  4. Tutor llamando la action rechazado con `solo_admin`.
 */

describe('abrirConversacionAdminFamilia — server action core', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA1: { id: string }
  let aulaB1: { id: string }
  let ninoA1: { id: string }
  let ninoB: { id: string }

  let adminA: TestUser
  let adminB: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let profeA1: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro AC A')
    centroB = await createTestCentro('Centro AC B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula AC A1')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula AC B1')

    ninoA1 = await createTestNino(centroA.id, 'Niño AC A1')
    ninoB = await createTestNino(centroB.id, 'Niño AC B')

    await matricular(ninoA1.id, aulaA1.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin AC A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    adminB = await createTestUser({ nombre: 'Admin AC B' })
    await asignarRol(adminB.id, centroB.id, 'admin')

    tutorA = await createTestUser({ nombre: 'Tutor AC A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    tutorB = await createTestUser({ nombre: 'Tutor AC B' })
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    profeA1 = await createTestUser({ nombre: 'Profe AC A1' })
    await asignarRol(profeA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeA1.id, aulaA1.id)
  }, 180_000)

  afterAll(async () => {
    const usuarios = [adminA?.id, adminB?.id, tutorA?.id, tutorB?.id, profeA1?.id].filter(
      (u): u is string => Boolean(u)
    )
    await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
    await serviceClient.from('conversaciones').delete().in('tutor_id', [tutorA?.id, tutorB?.id])
    await serviceClient.from('conversaciones').delete().in('nino_id', [ninoA1.id, ninoB.id])
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA1.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA1.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA1.id, aulaB1.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 120_000)

  // -------------------------------------------------------------------
  // 1. Crea hilo nuevo
  // -------------------------------------------------------------------

  it('admin del centro crea un hilo nuevo con expires_at ≈ now()+3d', async () => {
    const sb = await clientFor(adminA)
    const before = Date.now()
    const result = await abrirConversacionAdminFamiliaCore(sb, adminA.id, tutorA.id)
    expect(result.success).toBe(true)
    if (!result.success) return

    // Verificamos el row creado en BD (service bypass RLS para introspección).
    const { data: conv } = await serviceClient
      .from('conversaciones')
      .select('id, tipo_conversacion, admin_id, tutor_id, centro_id, nino_id, expires_at')
      .eq('id', result.data.conversacion_id)
      .single()
    expect(conv).toBeTruthy()
    expect(conv?.tipo_conversacion).toBe('admin_familia')
    expect(conv?.admin_id).toBe(adminA.id)
    expect(conv?.tutor_id).toBe(tutorA.id)
    expect(conv?.centro_id).toBe(centroA.id)
    expect(conv?.nino_id).toBeNull()

    const exp = new Date(conv!.expires_at!).getTime()
    const expected = before + 3 * 24 * 60 * 60 * 1000
    expect(exp).toBeGreaterThan(expected - 60_000)
    expect(exp).toBeLessThan(expected + 120_000)
  })

  // -------------------------------------------------------------------
  // 2. Reapertura: solo expires_at se mueve
  // -------------------------------------------------------------------

  it('reapertura de hilo existente actualiza SOLO expires_at (id, admin_id, tutor_id, centro_id intactos)', async () => {
    const sb = await clientFor(adminA)

    // Snapshot inicial: capturamos el id y los campos invariantes.
    const { data: pre } = await serviceClient
      .from('conversaciones')
      .select('id, admin_id, tutor_id, centro_id, nino_id, expires_at, created_at')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
      .single()
    expect(pre).toBeTruthy()
    if (!pre) return

    // Forzamos un expires_at corto para detectar movimiento.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await serviceClient.from('conversaciones').update({ expires_at: inOneHour }).eq('id', pre.id)

    const before = Date.now()
    const result = await abrirConversacionAdminFamiliaCore(sb, adminA.id, tutorA.id)
    expect(result.success).toBe(true)
    if (!result.success) return
    // Devuelve el MISMO id (no crea uno nuevo).
    expect(result.data.conversacion_id).toBe(pre.id)

    const { data: post } = await serviceClient
      .from('conversaciones')
      .select('id, admin_id, tutor_id, centro_id, nino_id, expires_at, created_at')
      .eq('id', pre.id)
      .single()
    expect(post).toBeTruthy()
    if (!post) return

    // Campos invariantes — la action NO debe mutarlos.
    expect(post.id).toBe(pre.id)
    expect(post.admin_id).toBe(pre.admin_id)
    expect(post.tutor_id).toBe(pre.tutor_id)
    expect(post.centro_id).toBe(pre.centro_id)
    expect(post.nino_id).toBe(pre.nino_id)
    expect(post.created_at).toBe(pre.created_at)

    // expires_at sí se renueva a now()+3d.
    const exp = new Date(post.expires_at!).getTime()
    const expected = before + 3 * 24 * 60 * 60 * 1000
    expect(exp).toBeGreaterThan(expected - 60_000)
    expect(exp).toBeLessThan(expected + 120_000)
  })

  // -------------------------------------------------------------------
  // 3. Admin de otro centro contra tutor ajeno → tutor_no_pertenece_centro
  // -------------------------------------------------------------------

  it('admin de otro centro contra tutor ajeno → tutor_no_pertenece_centro', async () => {
    const sb = await clientFor(adminB)
    const result = await abrirConversacionAdminFamiliaCore(sb, adminB.id, tutorA.id)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.tutor_no_pertenece_centro')

    // No se ha creado fila para (adminB, tutorA).
    const { data: rows } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('admin_id', adminB.id)
      .eq('tutor_id', tutorA.id)
    expect(rows?.length ?? 0).toBe(0)
  })

  // -------------------------------------------------------------------
  // 4. Tutor llamando la action → solo_admin
  // -------------------------------------------------------------------

  it('tutor (rol no admin) llamando la action → solo_admin', async () => {
    const sb = await clientFor(tutorA)
    const result = await abrirConversacionAdminFamiliaCore(sb, tutorA.id, tutorB.id)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.solo_admin')
  })

  // -------------------------------------------------------------------
  // 5. Profe (rol no admin) → solo_admin (defensa adicional)
  // -------------------------------------------------------------------

  it('profe (rol no admin) llamando la action → solo_admin', async () => {
    const sb = await clientFor(profeA1)
    const result = await abrirConversacionAdminFamiliaCore(sb, profeA1.id, tutorA.id)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.solo_admin')
  })
})
