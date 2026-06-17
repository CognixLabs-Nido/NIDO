import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { abrirConversacionAdminFamiliaCore } from '@/features/messaging/actions/abrir-conversacion-admin-familia'
import { enviarMensajeCore } from '@/features/messaging/actions/enviar-mensaje'

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
 * Tests de `enviarMensajeCore` rama admin_familia (Fase 5.6-A C1.5).
 *
 * Cubrimos los dos escenarios pedidos en la spec:
 *   1. Envío OK en hilo activo: mensaje insertado + `expires_at` renovado
 *      por el trigger AFTER INSERT.
 *   2. Envío en hilo caducado: `conversacion_caducada` sin insertar mensaje
 *      (el pre-check de la action bloquea antes de llegar a la RLS).
 *
 * También incluimos una regresión profe_familia mínima al nivel del action:
 * `enviarMensajeCore({ kind: 'profe_familia', nino_id, contenido })` sigue
 * creando la conversación lazy + insertando el mensaje. Los tests existentes
 * del schema y de MensajeComposer cubren el resto del contrato profe_familia.
 */

describe('enviarMensaje — rama admin_familia + regresión profe_familia', () => {
  let centroA: { id: string }
  let cursoA: { id: string }
  let aulaA1: { id: string }
  let ninoA1: { id: string }

  let adminA: TestUser
  let tutorA: TestUser
  let profeA: TestUser

  let convAdminFamilia: { id: string }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro EM A')
    cursoA = await createTestCurso(centroA.id)
    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula EM A1')
    ninoA1 = await createTestNino(centroA.id, 'Niño EM A1')
    await matricular(ninoA1.id, aulaA1.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin EM A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    tutorA = await createTestUser({ nombre: 'Tutor EM A' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    // Profe del aula del niño → puede postear profe_familia (es_profe_de_nino).
    profeA = await createTestUser({ nombre: 'Profe EM A' })
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA1.id)

    // Abrimos un hilo admin_familia para los tests posteriores.
    const adminClient = await clientFor(adminA)
    const open = await abrirConversacionAdminFamiliaCore(adminClient, adminA.id, tutorA.id)
    if (!open.success) throw new Error(`seed open admin_familia: ${open.error}`)
    convAdminFamilia = { id: open.data.conversacion_id }
  }, 180_000)

  afterAll(async () => {
    const usuarios = [adminA?.id, tutorA?.id, profeA?.id].filter((u): u is string => Boolean(u))
    await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
    await serviceClient.from('conversaciones').delete().in('tutor_id', [tutorA?.id])
    await serviceClient.from('conversaciones').delete().in('nino_id', [ninoA1.id])
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA1.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA1.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA1.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id])
    await deleteTestCentro(centroA.id)
  }, 120_000)

  // -------------------------------------------------------------------
  // 1. admin_familia OK + renovación del timer
  // -------------------------------------------------------------------

  it('admin envía mensaje en hilo activo → insertado + expires_at renovado a now()+3d', async () => {
    const sb = await clientFor(adminA)

    // Forzamos un expires_at corto para verificar la renovación.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await serviceClient
      .from('conversaciones')
      .update({ expires_at: inOneHour })
      .eq('id', convAdminFamilia.id)

    const before = Date.now()
    const result = await enviarMensajeCore(sb, adminA.id, {
      kind: 'admin_familia',
      conversacion_id: convAdminFamilia.id,
      contenido: 'hola familia, somos la dirección',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.conversacion_id).toBe(convAdminFamilia.id)

    // Mensaje persistido con el autor correcto.
    const { data: msg } = await serviceClient
      .from('mensajes')
      .select('id, autor_id, contenido, conversacion_id')
      .eq('id', result.data.mensaje_id)
      .single()
    expect(msg?.autor_id).toBe(adminA.id)
    expect(msg?.conversacion_id).toBe(convAdminFamilia.id)
    expect(msg?.contenido).toBe('hola familia, somos la dirección')

    // expires_at renovado por el trigger.
    const { data: conv } = await serviceClient
      .from('conversaciones')
      .select('expires_at')
      .eq('id', convAdminFamilia.id)
      .single()
    const exp = new Date(conv!.expires_at!).getTime()
    const expected = before + 3 * 24 * 60 * 60 * 1000
    expect(exp).toBeGreaterThan(expected - 60_000)
    expect(exp).toBeLessThan(expected + 120_000)
  })

  it('tutor también envía OK en hilo activo (sigue dentro de la ventana)', async () => {
    const sb = await clientFor(tutorA)
    const result = await enviarMensajeCore(sb, tutorA.id, {
      kind: 'admin_familia',
      conversacion_id: convAdminFamilia.id,
      contenido: 'gracias por avisar',
    })
    expect(result.success).toBe(true)
  })

  // -------------------------------------------------------------------
  // 2. admin_familia caducada → conversacion_caducada, sin mensaje
  // -------------------------------------------------------------------

  it('envío en hilo caducado → conversacion_caducada y NO se inserta mensaje', async () => {
    const sb = await clientFor(adminA)

    const past = new Date(Date.now() - 60 * 1000).toISOString()
    await serviceClient
      .from('conversaciones')
      .update({ expires_at: past })
      .eq('id', convAdminFamilia.id)

    // Snapshot del nº de mensajes antes.
    const { count: beforeCount } = await serviceClient
      .from('mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('conversacion_id', convAdminFamilia.id)

    const result = await enviarMensajeCore(sb, adminA.id, {
      kind: 'admin_familia',
      conversacion_id: convAdminFamilia.id,
      contenido: 'no debería llegar',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.conversacion_caducada')

    // Confirmamos que el INSERT no ocurrió.
    const { count: afterCount } = await serviceClient
      .from('mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('conversacion_id', convAdminFamilia.id)
    expect(afterCount).toBe(beforeCount)
  })

  it('tutor en hilo caducado también recibe conversacion_caducada', async () => {
    const sb = await clientFor(tutorA)
    // sigue caducada del test anterior; reforzamos por si:
    const past = new Date(Date.now() - 60 * 1000).toISOString()
    await serviceClient
      .from('conversaciones')
      .update({ expires_at: past })
      .eq('id', convAdminFamilia.id)

    const result = await enviarMensajeCore(sb, tutorA.id, {
      kind: 'admin_familia',
      conversacion_id: convAdminFamilia.id,
      contenido: 'no debería llegar tampoco',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.conversacion_caducada')
  })

  // -------------------------------------------------------------------
  // 3. Regresión profe_familia + least-privilege F11-A.
  //
  //    La rama profe_familia sigue funcional (creación lazy + INSERT) bajo el
  //    nuevo schema, PERO solo para quien puede POSTEAR: profe del niño o tutor
  //    con `puede_recibir_mensajes`. El admin LEE (supervisión) pero NO postea
  //    profe_familia desde la migración `20260613180000_phase11a_mensajeria_
  //    least_privilege` (helper `puede_postear_en_conversacion`, RGPD). Antes de
  //    F11-A este caso usaba `adminA` como autor y esperaba éxito — quedó obsoleto.
  // -------------------------------------------------------------------

  it('regresión profe_familia: el TUTOR crea la conv lazy + inserta', async () => {
    const tutorClient = await clientFor(tutorA)
    const result = await enviarMensajeCore(tutorClient, tutorA.id, {
      kind: 'profe_familia',
      nino_id: ninoA1.id,
      contenido: 'mensaje profe_familia desde el tutor',
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    const { data: conv } = await serviceClient
      .from('conversaciones')
      .select('id, tipo_conversacion, nino_id, expires_at')
      .eq('id', result.data.conversacion_id)
      .single()
    expect(conv?.tipo_conversacion).toBe('profe_familia')
    expect(conv?.nino_id).toBe(ninoA1.id)
    expect(conv?.expires_at).toBeNull() // profe_familia nunca caduca
  })

  it('profe_familia: el PROFE del niño también puede postear', async () => {
    const profeClient = await clientFor(profeA)
    const result = await enviarMensajeCore(profeClient, profeA.id, {
      kind: 'profe_familia',
      nino_id: ninoA1.id,
      contenido: 'mensaje profe_familia desde la profe',
    })
    expect(result.success).toBe(true)
  })

  it('least-privilege F11-A: el ADMIN NO puede postear profe_familia → sin_permisos', async () => {
    // La directora supervisa (lee) pero no postea en hilos profe↔familia
    // (helper `puede_postear_en_conversacion` excluye admin; RGPD bloqueante).
    const adminClient = await clientFor(adminA)
    const result = await enviarMensajeCore(adminClient, adminA.id, {
      kind: 'profe_familia',
      nino_id: ninoA1.id,
      contenido: 'la dirección NO debería poder postear aquí',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe('messages.errors.sin_permisos')
  })
})
