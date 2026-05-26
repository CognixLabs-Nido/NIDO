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
 * RLS de mensajería (Fase 5).
 *
 * Cubre los 20 escenarios definidos en docs/specs/messaging.md:
 * aislamiento por centro y aula, suplantación, flag global
 * `puede_recibir_mensajes` (bloquea conversaciones Y anuncios), DELETE
 * bloqueado a todos, UPDATE solo por autor, RLS de anuncios por ámbito
 * y centro, lectura_* solo propia.
 *
 * Patrón heredado de F3/F4: serviceClient bypassa RLS para sembrar
 * fixtures; clientFor(user) ejerce las políticas desde el rol auth real.
 */

describe('RLS mensajería — aislamiento, ámbitos y flag global', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA1: { id: string }
  let aulaA2: { id: string }
  let aulaB1: { id: string }
  let ninoA1: { id: string }
  let ninoA2: { id: string }
  let ninoB: { id: string }

  let adminA: TestUser
  let profeAulaA1: TestUser
  let profeAulaA2: TestUser
  let profeCentroB: TestUser
  let tutorConPermisoNinoA1: TestUser
  let tutorSinPermisoNinoA1: TestUser
  let tutorOtroNinoA2: TestUser

  let convA1: { id: string }
  let convB: { id: string }

  // mensaje preexistente en convA1 escrito por profeAulaA1 (para test UPDATE no-autor)
  let mensajeProfeA1: { id: string }

  // anuncios precargados (centroA solo)
  let anuncioAulaA1: { id: string }
  let anuncioCentroA: { id: string }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Msg A')
    centroB = await createTestCentro('Centro Msg B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula A1-Msg')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula A2-Msg')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula B1-Msg')

    ninoA1 = await createTestNino(centroA.id, 'Niño Msg A1')
    ninoA2 = await createTestNino(centroA.id, 'Niño Msg A2')
    ninoB = await createTestNino(centroB.id, 'Niño Msg B')

    await matricular(ninoA1.id, aulaA1.id, cursoA.id)
    await matricular(ninoA2.id, aulaA2.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin Msg A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeAulaA1 = await createTestUser({ nombre: 'Profe Aula A1 Msg' })
    await asignarRol(profeAulaA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA1.id, aulaA1.id)

    profeAulaA2 = await createTestUser({ nombre: 'Profe Aula A2 Msg' })
    await asignarRol(profeAulaA2.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA2.id, aulaA2.id)

    profeCentroB = await createTestUser({ nombre: 'Profe Centro B Msg' })
    await asignarRol(profeCentroB.id, centroB.id, 'profe')
    await asignarProfeAula(profeCentroB.id, aulaB1.id)

    tutorConPermisoNinoA1 = await createTestUser({ nombre: 'Tutor con permiso A1' })
    await asignarRol(tutorConPermisoNinoA1.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorConPermisoNinoA1.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    tutorSinPermisoNinoA1 = await createTestUser({ nombre: 'Tutor sin permiso A1' })
    await asignarRol(tutorSinPermisoNinoA1.id, centroA.id, 'autorizado')
    await crearVinculo(ninoA1.id, tutorSinPermisoNinoA1.id, 'autorizado', {
      puede_recibir_mensajes: false,
    })

    tutorOtroNinoA2 = await createTestUser({ nombre: 'Tutor otro niño A2' })
    await asignarRol(tutorOtroNinoA2.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA2.id, tutorOtroNinoA2.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    // Conversaciones preexistentes con un mensaje cada una (vía service):
    // convA1 (niñoA1 / centroA) con mensaje del profe; convB (niñoB / centroB).
    const { data: cA1, error: cA1Err } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoA1.id, centro_id: centroA.id })
      .select('id')
      .single()
    if (cA1Err || !cA1) throw new Error(`seed convA1: ${cA1Err?.message}`)
    convA1 = { id: cA1.id }

    const { data: mProfe, error: mProfeErr } = await serviceClient
      .from('mensajes')
      .insert({
        conversacion_id: convA1.id,
        autor_id: profeAulaA1.id,
        contenido: 'mensaje-seed-profe-A1',
      })
      .select('id')
      .single()
    if (mProfeErr || !mProfe) throw new Error(`seed mensaje convA1: ${mProfeErr?.message}`)
    mensajeProfeA1 = { id: mProfe.id }

    const { data: cB, error: cBErr } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoB.id, centro_id: centroB.id })
      .select('id')
      .single()
    if (cBErr || !cB) throw new Error(`seed convB: ${cBErr?.message}`)
    convB = { id: cB.id }

    await serviceClient.from('mensajes').insert({
      conversacion_id: convB.id,
      autor_id: profeCentroB.id,
      contenido: 'mensaje-seed-centro-B',
    })

    // Anuncios preexistentes (centroA):
    //  - anuncioAulaA1: ámbito=aula, aula=aulaA1, autor=profeAulaA1
    //  - anuncioCentroA: ámbito=centro, autor=adminA
    const { data: aAula, error: aAulaErr } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: profeAulaA1.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aulaA1.id,
        titulo: 'Aviso aula A1',
        contenido: 'contenido-aviso-aula-A1',
      })
      .select('id')
      .single()
    if (aAulaErr || !aAula) throw new Error(`seed anuncioAulaA1: ${aAulaErr?.message}`)
    anuncioAulaA1 = { id: aAula.id }

    const { data: aCentro, error: aCentroErr } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: adminA.id,
        centro_id: centroA.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 'Aviso centro A',
        contenido: 'contenido-aviso-centro-A',
      })
      .select('id')
      .single()
    if (aCentroErr || !aCentro) throw new Error(`seed anuncioCentroA: ${aCentroErr?.message}`)
    anuncioCentroA = { id: aCentro.id }
  }, 180_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      profeAulaA1?.id,
      profeAulaA2?.id,
      profeCentroB?.id,
      tutorConPermisoNinoA1?.id,
      tutorSinPermisoNinoA1?.id,
      tutorOtroNinoA2?.id,
    ].filter((u): u is string => Boolean(u))

    await serviceClient.from('lectura_anuncio').delete().in('usuario_id', usuarios)
    await serviceClient.from('lectura_conversacion').delete().in('usuario_id', usuarios)
    await serviceClient.from('anuncios').delete().in('autor_id', usuarios)
    await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
    await serviceClient
      .from('conversaciones')
      .delete()
      .in('nino_id', [ninoA1.id, ninoA2.id, ninoB.id])
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA1.id, ninoA2.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA1.id, ninoA2.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA1.id, aulaA2.id, aulaB1.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 120_000)

  // -------------------------------------------------------------------
  // Conversaciones — SELECT (aislamiento y permisos)
  // -------------------------------------------------------------------

  it('t01 — tutor sin puede_recibir_mensajes NO ve conversaciones de su niño', async () => {
    const client = await clientFor(tutorSinPermisoNinoA1)
    const { data, error } = await client.from('conversaciones').select('id').eq('id', convA1.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('t02 — tutor de niño A1 NO ve conversaciones del niño A2', async () => {
    const client = await clientFor(tutorConPermisoNinoA1)
    const { data, error } = await client
      .from('conversaciones')
      .select('id, nino_id')
      .eq('nino_id', ninoA2.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('t03 — profe del aula A1 NO ve conversaciones del aula A2 (mismo centro)', async () => {
    // Sembramos primero una conversación para ninoA2 (aulaA2) y luego la profe
    // del aulaA1 intenta listarla. Limpieza al final del test.
    const { data: convA2, error: convA2Err } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoA2.id, centro_id: centroA.id })
      .select('id')
      .single()
    expect(convA2Err).toBeNull()

    const client = await clientFor(profeAulaA1)
    const { data, error } = await client.from('conversaciones').select('id').eq('id', convA2!.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)

    await serviceClient.from('conversaciones').delete().eq('id', convA2!.id)
  })

  it('t04 — profe de centro X NO ve conversaciones del centro Y', async () => {
    const client = await clientFor(profeCentroB)
    const { data, error } = await client
      .from('conversaciones')
      .select('id, nino_id')
      .eq('id', convA1.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('t05 — admin del centro ve TODAS las conversaciones del centro', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('conversaciones')
      .select('id')
      .eq('centro_id', centroA.id)
    expect(error).toBeNull()
    // Al menos convA1 (creada en setup). Admin observa todo el centro.
    expect((data ?? []).map((c) => c.id)).toContain(convA1.id)
  })

  // -------------------------------------------------------------------
  // Mensajes — INSERT y anti-suplantación
  // -------------------------------------------------------------------

  it('t06 — profe del aula del niño puede INSERT en mensajes', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('mensajes')
      .insert({
        conversacion_id: convA1.id,
        autor_id: profeAulaA1.id,
        contenido: 't06-profe-puede-escribir',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) await serviceClient.from('mensajes').delete().eq('id', data.id)
  })

  it('t07 — tutor con puede_recibir_mensajes puede INSERT en mensajes', async () => {
    const client = await clientFor(tutorConPermisoNinoA1)
    const { data, error } = await client
      .from('mensajes')
      .insert({
        conversacion_id: convA1.id,
        autor_id: tutorConPermisoNinoA1.id,
        contenido: 't07-tutor-puede-escribir',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) await serviceClient.from('mensajes').delete().eq('id', data.id)
  })

  it('t08 — NO se puede INSERT mensaje con autor_id != auth.uid() (anti-suplantación)', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('mensajes')
      .insert({
        conversacion_id: convA1.id,
        autor_id: tutorConPermisoNinoA1.id, // distinto al usuario auth
        contenido: 't08-intento-suplantacion',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  // -------------------------------------------------------------------
  // Anuncios — INSERT por ámbito y por centro
  // -------------------------------------------------------------------

  it('t09 — profe NO puede INSERT anuncio ámbito=centro (solo admin)', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('anuncios')
      .insert({
        autor_id: profeAulaA1.id,
        centro_id: centroA.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 't09-prohibido',
        contenido: 't09-prohibido',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('t10 — profe NO puede INSERT anuncio con aula_id de otra aula', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('anuncios')
      .insert({
        autor_id: profeAulaA1.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aulaA2.id, // no es su aula
        titulo: 't10-prohibido',
        contenido: 't10-prohibido',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('t11 — profe NO puede INSERT anuncio con aula_id de otro centro', async () => {
    // profeCentroB intenta publicar en aulaA1 (centroA): RLS rechaza por
    // centro_de_aula(aula_id) != centro_id Y por es_profe_de_aula = false.
    const client = await clientFor(profeCentroB)
    const { data, error } = await client
      .from('anuncios')
      .insert({
        autor_id: profeCentroB.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aulaA1.id,
        titulo: 't11-prohibido-cross-centro',
        contenido: 't11-prohibido',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('t12 — admin puede INSERT anuncio ámbito=centro sin aula_id', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('anuncios')
      .insert({
        autor_id: adminA.id,
        centro_id: centroA.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 't12-admin-centro',
        contenido: 't12-admin-centro',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) await serviceClient.from('anuncios').delete().eq('id', data.id)
  })

  it('t13 — admin puede INSERT anuncio ámbito=aula con aula_id del centro', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('anuncios')
      .insert({
        autor_id: adminA.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aulaA2.id,
        titulo: 't13-admin-aula',
        contenido: 't13-admin-aula',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) await serviceClient.from('anuncios').delete().eq('id', data.id)
  })

  // -------------------------------------------------------------------
  // Anuncios — SELECT (audiencia) y flag global puede_recibir_mensajes
  // -------------------------------------------------------------------

  it('t14 — tutor del aula recibe el anuncio ámbito=aula correspondiente', async () => {
    const client = await clientFor(tutorConPermisoNinoA1)
    const { data, error } = await client
      .from('anuncios')
      .select('id, ambito, aula_id')
      .eq('id', anuncioAulaA1.id)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(anuncioAulaA1.id)
    expect(data?.ambito).toBe('aula')
  })

  it('t15 — tutor con puede_recibir_mensajes recibe anuncio ámbito=centro', async () => {
    const client = await clientFor(tutorConPermisoNinoA1)
    const { data, error } = await client
      .from('anuncios')
      .select('id, ambito')
      .eq('id', anuncioCentroA.id)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(anuncioCentroA.id)
    expect(data?.ambito).toBe('centro')
  })

  it('t16 — tutor sin puede_recibir_mensajes NO recibe NINGÚN anuncio (aula ni centro)', async () => {
    const client = await clientFor(tutorSinPermisoNinoA1)
    const { data: aula, error: aulaErr } = await client
      .from('anuncios')
      .select('id')
      .eq('id', anuncioAulaA1.id)
    expect(aulaErr).toBeNull()
    expect((aula ?? []).length).toBe(0)

    const { data: centro, error: centroErr } = await client
      .from('anuncios')
      .select('id')
      .eq('id', anuncioCentroA.id)
    expect(centroErr).toBeNull()
    expect((centro ?? []).length).toBe(0)
  })

  // -------------------------------------------------------------------
  // DELETE bloqueado a todos
  // -------------------------------------------------------------------

  it('t17 — DELETE bloqueado a todos en conversaciones, mensajes, anuncios, lectura_*', async () => {
    const client = await clientFor(adminA)

    // conversaciones
    await client.from('conversaciones').delete().eq('id', convA1.id)
    const { data: convAfter } = await serviceClient
      .from('conversaciones')
      .select('id')
      .eq('id', convA1.id)
      .maybeSingle()
    expect(convAfter?.id).toBe(convA1.id)

    // mensajes
    await client.from('mensajes').delete().eq('id', mensajeProfeA1.id)
    const { data: msgAfter } = await serviceClient
      .from('mensajes')
      .select('id')
      .eq('id', mensajeProfeA1.id)
      .maybeSingle()
    expect(msgAfter?.id).toBe(mensajeProfeA1.id)

    // anuncios
    await client.from('anuncios').delete().eq('id', anuncioAulaA1.id)
    const { data: anuncioAfter } = await serviceClient
      .from('anuncios')
      .select('id')
      .eq('id', anuncioAulaA1.id)
      .maybeSingle()
    expect(anuncioAfter?.id).toBe(anuncioAulaA1.id)

    // lectura_conversacion: sembramos primero una para tutor, luego intentamos borrar.
    await serviceClient.from('lectura_conversacion').insert({
      usuario_id: tutorConPermisoNinoA1.id,
      conversacion_id: convA1.id,
      last_read_at: new Date().toISOString(),
    })
    const tutorClient = await clientFor(tutorConPermisoNinoA1)
    await tutorClient
      .from('lectura_conversacion')
      .delete()
      .eq('usuario_id', tutorConPermisoNinoA1.id)
    const { data: lcAfter } = await serviceClient
      .from('lectura_conversacion')
      .select('id')
      .eq('usuario_id', tutorConPermisoNinoA1.id)
      .eq('conversacion_id', convA1.id)
      .maybeSingle()
    expect(lcAfter?.id).toBeTruthy()
  })

  // -------------------------------------------------------------------
  // UPDATE — solo el autor (mensajes, anuncios). conversaciones sin policy.
  // -------------------------------------------------------------------

  it('t18 — UPDATE de mensaje por NO-autor: rechazado (0 filas afectadas)', async () => {
    const client = await clientFor(tutorConPermisoNinoA1) // no es el autor
    const { error } = await client
      .from('mensajes')
      .update({ contenido: 'no-deberia-cambiar' })
      .eq('id', mensajeProfeA1.id)
    expect(error).toBeNull() // 0 filas no devuelve error
    const { data: verify } = await serviceClient
      .from('mensajes')
      .select('contenido')
      .eq('id', mensajeProfeA1.id)
      .single()
    expect(verify?.contenido).toBe('mensaje-seed-profe-A1')
  })

  it('t19 — UPDATE de conversaciones por cualquier rol: rechazado (sin policy)', async () => {
    const client = await clientFor(adminA)
    const { error } = await client
      .from('conversaciones')
      .update({ centro_id: centroB.id }) // intento de mover de centro
      .eq('id', convA1.id)
    expect(error).toBeNull() // 0 filas
    const { data: verify } = await serviceClient
      .from('conversaciones')
      .select('centro_id')
      .eq('id', convA1.id)
      .single()
    expect(verify?.centro_id).toBe(centroA.id) // sigue en su centro
  })

  // -------------------------------------------------------------------
  // lectura_conversacion — anti-suplantación
  // -------------------------------------------------------------------

  it('t20 — usuario A NO puede insertar lectura_conversacion con usuario_id = B', async () => {
    const client = await clientFor(tutorConPermisoNinoA1)
    const { data, error } = await client
      .from('lectura_conversacion')
      .insert({
        usuario_id: adminA.id, // distinto al usuario auth
        conversacion_id: convA1.id,
        last_read_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
