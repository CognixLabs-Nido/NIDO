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
 * RLS Fase 5.6-A — conversaciones admin ↔ familia.
 *
 * Cubre la sección 6 de docs/specs/phase-5-6-admin-family-messaging.md:
 * aislamiento por par (admin, tutor) y por centro, prohibición de creación
 * por la familia, caducidad por `expires_at`, reapertura por el admin,
 * trigger AFTER INSERT que renueva el timer (incluida la rama SECURITY
 * DEFINER cuando el tutor inserta), y regresión profe_familia post-nullable.
 */

describe('RLS admin↔familia — aislamiento per-par, caducidad, reapertura', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA1: { id: string }
  let aulaB1: { id: string }
  let ninoA1: { id: string }
  let ninoB: { id: string }

  let adminA: TestUser
  let adminA2: TestUser
  let adminB: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let profeA1: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro AF A')
    centroB = await createTestCentro('Centro AF B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula AF A1')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula AF B1')

    ninoA1 = await createTestNino(centroA.id, 'Niño AF A1')
    ninoB = await createTestNino(centroB.id, 'Niño AF B')

    await matricular(ninoA1.id, aulaA1.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin AF A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    adminA2 = await createTestUser({ nombre: 'Admin AF A2' })
    await asignarRol(adminA2.id, centroA.id, 'admin')

    adminB = await createTestUser({ nombre: 'Admin AF B' })
    await asignarRol(adminB.id, centroB.id, 'admin')

    tutorA = await createTestUser({ nombre: 'Tutor AF A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    tutorB = await createTestUser({ nombre: 'Tutor AF B' })
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    profeA1 = await createTestUser({ nombre: 'Profe AF A1' })
    await asignarRol(profeA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeA1.id, aulaA1.id)
  }, 180_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      adminA2?.id,
      adminB?.id,
      tutorA?.id,
      tutorB?.id,
      profeA1?.id,
    ].filter((u): u is string => Boolean(u))

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
  // CHECK de coherencia (estructural, no RLS)
  // -------------------------------------------------------------------

  it('CHECK rechaza admin_familia con nino_id NOT NULL', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await serviceClient.from('conversaciones').insert({
      nino_id: ninoA1.id, // ← inválido para admin_familia
      centro_id: centroA.id,
      tipo_conversacion: 'admin_familia',
      admin_id: adminA.id,
      tutor_id: tutorA.id,
      expires_at: future,
    })
    expect(error).toBeTruthy()
    expect(error?.message).toMatch(/conversaciones_tipo_coherencia/)
  })

  it('CHECK rechaza profe_familia con tutor_id NOT NULL', async () => {
    const { error } = await serviceClient.from('conversaciones').insert({
      nino_id: ninoA1.id,
      centro_id: centroA.id,
      tipo_conversacion: 'profe_familia',
      tutor_id: tutorA.id, // ← inválido para profe_familia
    })
    expect(error).toBeTruthy()
    expect(error?.message).toMatch(/conversaciones_tipo_coherencia/)
  })

  it('CHECK rechaza admin_familia sin expires_at', async () => {
    const { error } = await serviceClient.from('conversaciones').insert({
      centro_id: centroA.id,
      tipo_conversacion: 'admin_familia',
      admin_id: adminA.id,
      tutor_id: tutorA.id,
      // expires_at omitido
    })
    expect(error).toBeTruthy()
    expect(error?.message).toMatch(/conversaciones_tipo_coherencia/)
  })

  // -------------------------------------------------------------------
  // Regresión F5: profe_familia funciona sin tocar
  // -------------------------------------------------------------------

  it('regresión F5: INSERT profe_familia con default `tipo_conversacion` funciona', async () => {
    // Reproduce el flow F5 sin pasar tipo_conversacion. El DEFAULT 'profe_familia'
    // debe seguir cubriendo el patrón existente, con nino_id no nulo y resto NULL.
    const { data, error } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoA1.id, centro_id: centroA.id })
      .select('id, tipo_conversacion, nino_id, tutor_id, admin_id, expires_at')
      .single()
    expect(error).toBeNull()
    expect(data?.tipo_conversacion).toBe('profe_familia')
    expect(data?.nino_id).toBe(ninoA1.id)
    expect(data?.tutor_id).toBeNull()
    expect(data?.admin_id).toBeNull()
    expect(data?.expires_at).toBeNull()
    // limpieza local
    if (data?.id) await serviceClient.from('conversaciones').delete().eq('id', data.id)
  })

  // -------------------------------------------------------------------
  // INSERT conversaciones admin_familia — quién puede crear
  // -------------------------------------------------------------------

  it('admin del centro PUEDE crear conversación admin_familia con tutor de su centro', async () => {
    const adminAClient = await clientFor(adminA)
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await adminAClient
      .from('conversaciones')
      .insert({
        centro_id: centroA.id,
        tipo_conversacion: 'admin_familia',
        admin_id: adminA.id,
        tutor_id: tutorA.id,
        expires_at: future,
      })
      .select('id, admin_id, tutor_id, tipo_conversacion, expires_at')
      .single()
    expect(error).toBeNull()
    expect(data?.admin_id).toBe(adminA.id)
    expect(data?.tutor_id).toBe(tutorA.id)
    expect(data?.tipo_conversacion).toBe('admin_familia')
  })

  it('UNIQUE parcial: segundo INSERT con mismo (admin, tutor) falla', async () => {
    const adminAClient = await clientFor(adminA)
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await adminAClient.from('conversaciones').insert({
      centro_id: centroA.id,
      tipo_conversacion: 'admin_familia',
      admin_id: adminA.id,
      tutor_id: tutorA.id,
      expires_at: future,
    })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('23505') // unique_violation
  })

  it('admin de OTRO centro NO puede crear conversación con tutor del centro A', async () => {
    const adminBClient = await clientFor(adminB)
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await adminBClient.from('conversaciones').insert({
      centro_id: centroB.id, // su propio centro
      tipo_conversacion: 'admin_familia',
      admin_id: adminB.id,
      tutor_id: tutorA.id, // pero tutor de centro A → NO pertenece
      expires_at: future,
    })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })

  it('admin NO puede suplantar admin_id (anti-suplantación)', async () => {
    const adminAClient = await clientFor(adminA)
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await adminAClient.from('conversaciones').insert({
      centro_id: centroA.id,
      tipo_conversacion: 'admin_familia',
      admin_id: adminA2.id, // ← inserta a nombre de otro admin
      tutor_id: tutorA.id,
      expires_at: future,
    })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })

  it('tutor NO puede crear conversación admin_familia (solo el admin inicia)', async () => {
    const tutorAClient = await clientFor(tutorA)
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await tutorAClient.from('conversaciones').insert({
      centro_id: centroA.id,
      tipo_conversacion: 'admin_familia',
      admin_id: adminA.id,
      tutor_id: tutorA.id,
      expires_at: future,
    })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })

  // -------------------------------------------------------------------
  // SELECT admin_familia — visibilidad per-par
  // -------------------------------------------------------------------

  it('admin (par) y tutor (par) PUEDEN leer su conversación admin_familia', async () => {
    const adminAClient = await clientFor(adminA)
    const tutorAClient = await clientFor(tutorA)

    const { data: dataAdmin, error: errAdmin } = await adminAClient
      .from('conversaciones')
      .select('id, tipo_conversacion')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    expect(errAdmin).toBeNull()
    expect(dataAdmin?.length).toBe(1)

    const { data: dataTutor, error: errTutor } = await tutorAClient
      .from('conversaciones')
      .select('id, tipo_conversacion')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    expect(errTutor).toBeNull()
    expect(dataTutor?.length).toBe(1)
  })

  it('OTRO admin del mismo centro NO ve la conversación (privacidad per-par)', async () => {
    const adminA2Client = await clientFor(adminA2)
    const { data, error } = await adminA2Client
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('tutor_id', tutorA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(0)
  })

  it('profe del centro NO ve la conversación admin_familia', async () => {
    const profeClient = await clientFor(profeA1)
    const { data, error } = await profeClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('tutor_id', tutorA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(0)
  })

  it('tutor de OTRO centro NO ve la conversación', async () => {
    const tutorBClient = await clientFor(tutorB)
    const { data, error } = await tutorBClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
    expect(error).toBeNull()
    expect(data?.length).toBe(0)
  })

  // -------------------------------------------------------------------
  // Mensajes en admin_familia: gating por `conversacion_activa`
  // -------------------------------------------------------------------

  it('admin inserta mensaje con hilo activo → trigger renueva expires_at a now()+3d', async () => {
    const adminAClient = await clientFor(adminA)
    // recupera id del hilo
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id, expires_at')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    expect(convs?.length).toBe(1)
    const convId = convs![0].id

    // Forzamos expires_at a un valor cercano (1h) para detectar la renovación.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await serviceClient.from('conversaciones').update({ expires_at: inOneHour }).eq('id', convId)

    const before = Date.now()
    const { error } = await adminAClient
      .from('mensajes')
      .insert({ conversacion_id: convId, autor_id: adminA.id, contenido: 'hola-tutor' })
    expect(error).toBeNull()

    const { data: refreshed } = await serviceClient
      .from('conversaciones')
      .select('expires_at')
      .eq('id', convId)
      .single()
    const exp = new Date(refreshed!.expires_at!).getTime()
    // ~3 días después (margen ±60s)
    const expected = before + 3 * 24 * 60 * 60 * 1000
    expect(exp).toBeGreaterThan(expected - 60_000)
    expect(exp).toBeLessThan(expected + 120_000)
  })

  it('tutor inserta mensaje con hilo activo → trigger renueva expires_at (valida SECURITY DEFINER)', async () => {
    const tutorAClient = await clientFor(tutorA)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id

    // Vuelve a forzar timer corto.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await serviceClient.from('conversaciones').update({ expires_at: inOneHour }).eq('id', convId)

    const before = Date.now()
    const { error } = await tutorAClient
      .from('mensajes')
      .insert({ conversacion_id: convId, autor_id: tutorA.id, contenido: 'gracias-dirección' })
    expect(error).toBeNull()

    const { data: refreshed } = await serviceClient
      .from('conversaciones')
      .select('expires_at')
      .eq('id', convId)
      .single()
    const exp = new Date(refreshed!.expires_at!).getTime()
    const expected = before + 3 * 24 * 60 * 60 * 1000
    expect(exp).toBeGreaterThan(expected - 60_000)
    expect(exp).toBeLessThan(expected + 120_000)
  })

  it('INSERT mensaje BLOQUEADO cuando expires_at < now() (admin)', async () => {
    const adminAClient = await clientFor(adminA)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id

    const past = new Date(Date.now() - 60 * 1000).toISOString()
    await serviceClient.from('conversaciones').update({ expires_at: past }).eq('id', convId)

    const { error } = await adminAClient
      .from('mensajes')
      .insert({ conversacion_id: convId, autor_id: adminA.id, contenido: 'caducado' })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })

  it('INSERT mensaje BLOQUEADO cuando expires_at < now() (tutor)', async () => {
    const tutorAClient = await clientFor(tutorA)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id
    // sigue caducada del test anterior, garantizamos:
    const past = new Date(Date.now() - 60 * 1000).toISOString()
    await serviceClient.from('conversaciones').update({ expires_at: past }).eq('id', convId)

    const { error } = await tutorAClient
      .from('mensajes')
      .insert({ conversacion_id: convId, autor_id: tutorA.id, contenido: 'caducado-tutor' })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })

  it('SELECT sigue funcionando tras caducar (read-only post-expiry)', async () => {
    const adminAClient = await clientFor(adminA)
    const { data, error } = await adminAClient
      .from('conversaciones')
      .select('id, expires_at')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    // expires_at sigue en pasado
    expect(new Date(data![0].expires_at!).getTime()).toBeLessThan(Date.now())
  })

  // -------------------------------------------------------------------
  // Reapertura por el admin
  // -------------------------------------------------------------------

  it('admin REABRE actualizando expires_at → INSERT mensaje vuelve a funcionar', async () => {
    const adminAClient = await clientFor(adminA)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id

    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const { error: errUpd } = await adminAClient
      .from('conversaciones')
      .update({ expires_at: future })
      .eq('id', convId)
    expect(errUpd).toBeNull()

    const { error: errIns } = await adminAClient
      .from('mensajes')
      .insert({ conversacion_id: convId, autor_id: adminA.id, contenido: 'reabrimos' })
    expect(errIns).toBeNull()
  })

  it('OTRO admin (mismo centro) NO puede UPDATE expires_at del hilo ajeno', async () => {
    const adminA2Client = await clientFor(adminA2)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id

    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await adminA2Client
      .from('conversaciones')
      .update({ expires_at: future })
      .eq('id', convId)
      .select('id')
    // RLS UPDATE: USING devuelve FALSE para adminA2 → UPDATE no afecta filas, sin error
    // pero `data` queda vacío. Patrón coherente con RLS de Postgres.
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('tutor NO puede UPDATE expires_at (solo el admin reabre)', async () => {
    const tutorAClient = await clientFor(tutorA)
    const { data: convs } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'admin_familia')
      .eq('admin_id', adminA.id)
      .eq('tutor_id', tutorA.id)
    const convId = convs![0].id

    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data, error } = await tutorAClient
      .from('conversaciones')
      .update({ expires_at: past })
      .eq('id', convId)
      .select('id')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  // -------------------------------------------------------------------
  // Trigger: profe_familia NO se ve afectada
  // -------------------------------------------------------------------

  it('regresión trigger: INSERT mensaje en profe_familia NO toca expires_at (queda NULL)', async () => {
    // Crear profe_familia via service (bypass RLS), insertar mensaje, verificar.
    const { data: conv, error: errConv } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoA1.id, centro_id: centroA.id })
      .select('id')
      .single()
    expect(errConv).toBeNull()
    if (!conv) throw new Error('seed conv profe_familia failed')

    await serviceClient.from('mensajes').insert({
      conversacion_id: conv.id,
      autor_id: profeA1.id,
      contenido: 'hola-familia',
    })

    const { data: after } = await serviceClient
      .from('conversaciones')
      .select('expires_at, tipo_conversacion')
      .eq('id', conv.id)
      .single()
    expect(after?.tipo_conversacion).toBe('profe_familia')
    expect(after?.expires_at).toBeNull()

    // cleanup
    await serviceClient.from('mensajes').delete().eq('conversacion_id', conv.id)
    await serviceClient.from('conversaciones').delete().eq('id', conv.id)
  })
})
