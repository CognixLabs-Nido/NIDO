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
 * Tests directos de los helpers SQL SECURITY DEFINER de mensajería:
 *  - puede_participar_conversacion(conv_id)
 *  - usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id)
 *    (row-aware, ver migración correctiva 20260525201151).
 *  - usuario_es_audiencia_anuncio(anuncio_id) (versión por id; sigue siendo
 *    correcta para evaluaciones sobre filas pre-existentes).
 *
 * Se llaman vía rpc() desde la sesión auth de cada usuario, ejerciendo
 * el `auth.uid()` interno del helper.
 */

describe('Helpers mensajería — puede_participar_conversacion y audiencia anuncio', () => {
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

  let convA1: { id: string }

  // Anuncios fijos para cada combinación que necesitamos validar.
  let anuncioAulaA1: { id: string; centro_id: string; autor_id: string; aula_id: string }
  let anuncioCentroA: { id: string; centro_id: string; autor_id: string }
  let anuncioAulaB1: { id: string; centro_id: string; autor_id: string; aula_id: string }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Helpers Msg A')
    centroB = await createTestCentro('Centro Helpers Msg B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'AulaA1-Helpers')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'AulaA2-Helpers')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'AulaB1-Helpers')

    ninoA1 = await createTestNino(centroA.id, 'NinoA1-Helpers')
    ninoA2 = await createTestNino(centroA.id, 'NinoA2-Helpers')
    ninoB = await createTestNino(centroB.id, 'NinoB-Helpers')

    await matricular(ninoA1.id, aulaA1.id, cursoA.id)
    await matricular(ninoA2.id, aulaA2.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin Helpers A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeAulaA1 = await createTestUser({ nombre: 'Profe Helpers A1' })
    await asignarRol(profeAulaA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA1.id, aulaA1.id)

    profeAulaA2 = await createTestUser({ nombre: 'Profe Helpers A2' })
    await asignarRol(profeAulaA2.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA2.id, aulaA2.id)

    profeCentroB = await createTestUser({ nombre: 'Profe Helpers B' })
    await asignarRol(profeCentroB.id, centroB.id, 'profe')
    await asignarProfeAula(profeCentroB.id, aulaB1.id)

    tutorConPermisoNinoA1 = await createTestUser({ nombre: 'Tutor con perm A1' })
    await asignarRol(tutorConPermisoNinoA1.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA1.id, tutorConPermisoNinoA1.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })

    tutorSinPermisoNinoA1 = await createTestUser({ nombre: 'Tutor sin perm A1' })
    await asignarRol(tutorSinPermisoNinoA1.id, centroA.id, 'autorizado')
    await crearVinculo(ninoA1.id, tutorSinPermisoNinoA1.id, 'autorizado', {
      puede_recibir_mensajes: false,
    })

    // Conversación de niñoA1 (centroA)
    const { data: cA1, error: cA1Err } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: ninoA1.id, centro_id: centroA.id })
      .select('id')
      .single()
    if (cA1Err || !cA1) throw new Error(`seed convA1: ${cA1Err?.message}`)
    convA1 = { id: cA1.id }

    // Anuncio ámbito='aula' en aulaA1 (centroA), autor profeAulaA1.
    const { data: aAulaA1, error: aAulaA1Err } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: profeAulaA1.id,
        centro_id: centroA.id,
        ambito: 'aula',
        aula_id: aulaA1.id,
        titulo: 'Aviso aula A1 helpers',
        contenido: 'contenido aula A1 helpers',
      })
      .select('id, centro_id, autor_id, aula_id')
      .single()
    if (aAulaA1Err || !aAulaA1) throw new Error(`seed anuncioAulaA1: ${aAulaA1Err?.message}`)
    anuncioAulaA1 = {
      id: aAulaA1.id,
      centro_id: aAulaA1.centro_id,
      autor_id: aAulaA1.autor_id,
      aula_id: aAulaA1.aula_id!,
    }

    // Anuncio ámbito='centro' en centroA, autor adminA.
    const { data: aCentro, error: aCentroErr } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: adminA.id,
        centro_id: centroA.id,
        ambito: 'centro',
        aula_id: null,
        titulo: 'Aviso centro A helpers',
        contenido: 'contenido centro A helpers',
      })
      .select('id, centro_id, autor_id')
      .single()
    if (aCentroErr || !aCentro) throw new Error(`seed anuncioCentroA: ${aCentroErr?.message}`)
    anuncioCentroA = {
      id: aCentro.id,
      centro_id: aCentro.centro_id,
      autor_id: aCentro.autor_id,
    }

    // Anuncio ámbito='aula' en aulaB1 (centroB), autor profeCentroB.
    const { data: aAulaB1, error: aAulaB1Err } = await serviceClient
      .from('anuncios')
      .insert({
        autor_id: profeCentroB.id,
        centro_id: centroB.id,
        ambito: 'aula',
        aula_id: aulaB1.id,
        titulo: 'Aviso aula B1 helpers',
        contenido: 'contenido aula B1 helpers',
      })
      .select('id, centro_id, autor_id, aula_id')
      .single()
    if (aAulaB1Err || !aAulaB1) throw new Error(`seed anuncioAulaB1: ${aAulaB1Err?.message}`)
    anuncioAulaB1 = {
      id: aAulaB1.id,
      centro_id: aAulaB1.centro_id,
      autor_id: aAulaB1.autor_id,
      aula_id: aAulaB1.aula_id!,
    }
  }, 180_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      profeAulaA1?.id,
      profeAulaA2?.id,
      profeCentroB?.id,
      tutorConPermisoNinoA1?.id,
      tutorSinPermisoNinoA1?.id,
    ].filter((u): u is string => Boolean(u))
    await serviceClient.from('lectura_anuncio').delete().in('usuario_id', usuarios)
    await serviceClient.from('lectura_conversacion').delete().in('usuario_id', usuarios)
    await serviceClient.from('anuncios').delete().in('autor_id', usuarios)
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
  // puede_participar_conversacion
  // -------------------------------------------------------------------

  it('puede_participar_conversacion — profe del aula del niño → true; otra aula del mismo centro → false; admin del centro → true; tutor con/sin permiso → true/false', async () => {
    const profeA1 = await clientFor(profeAulaA1)
    const { data: r1 } = await profeA1.rpc('puede_participar_conversacion', {
      p_conversacion_id: convA1.id,
    })
    expect(r1).toBe(true)

    const profeA2 = await clientFor(profeAulaA2)
    const { data: r2 } = await profeA2.rpc('puede_participar_conversacion', {
      p_conversacion_id: convA1.id,
    })
    expect(r2).toBe(false)

    const admin = await clientFor(adminA)
    const { data: r3 } = await admin.rpc('puede_participar_conversacion', {
      p_conversacion_id: convA1.id,
    })
    expect(r3).toBe(true)

    const tutorCon = await clientFor(tutorConPermisoNinoA1)
    const { data: r4 } = await tutorCon.rpc('puede_participar_conversacion', {
      p_conversacion_id: convA1.id,
    })
    expect(r4).toBe(true)

    const tutorSin = await clientFor(tutorSinPermisoNinoA1)
    const { data: r5 } = await tutorSin.rpc('puede_participar_conversacion', {
      p_conversacion_id: convA1.id,
    })
    expect(r5).toBe(false)
  })

  // -------------------------------------------------------------------
  // usuario_es_audiencia_anuncio_row — ámbito='aula'
  // -------------------------------------------------------------------

  it('usuario_es_audiencia_anuncio_row — ámbito=aula: profe del aula true; tutor con permiso true; tutor sin permiso false; profe otra aula false; admin del centro true', async () => {
    const profeA1 = await clientFor(profeAulaA1)
    const { data: r1 } = await profeA1.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioAulaA1.centro_id,
      p_autor_id: anuncioAulaA1.autor_id,
      p_ambito: 'aula',
      p_aula_id: anuncioAulaA1.aula_id,
    })
    expect(r1).toBe(true)

    const tutorCon = await clientFor(tutorConPermisoNinoA1)
    const { data: r2 } = await tutorCon.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioAulaA1.centro_id,
      p_autor_id: anuncioAulaA1.autor_id,
      p_ambito: 'aula',
      p_aula_id: anuncioAulaA1.aula_id,
    })
    expect(r2).toBe(true)

    const tutorSin = await clientFor(tutorSinPermisoNinoA1)
    const { data: r3 } = await tutorSin.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioAulaA1.centro_id,
      p_autor_id: anuncioAulaA1.autor_id,
      p_ambito: 'aula',
      p_aula_id: anuncioAulaA1.aula_id,
    })
    expect(r3).toBe(false)

    const profeA2 = await clientFor(profeAulaA2)
    const { data: r4 } = await profeA2.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioAulaA1.centro_id,
      p_autor_id: anuncioAulaA1.autor_id,
      p_ambito: 'aula',
      p_aula_id: anuncioAulaA1.aula_id,
    })
    expect(r4).toBe(false)

    const admin = await clientFor(adminA)
    const { data: r5 } = await admin.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioAulaA1.centro_id,
      p_autor_id: anuncioAulaA1.autor_id,
      p_ambito: 'aula',
      p_aula_id: anuncioAulaA1.aula_id,
    })
    expect(r5).toBe(true)
  })

  // -------------------------------------------------------------------
  // usuario_es_audiencia_anuncio_row — ámbito='centro'
  // -------------------------------------------------------------------

  it('usuario_es_audiencia_anuncio_row — ámbito=centro: profe del centro true; tutor con permiso true; tutor sin permiso false; admin true; usuario de otro centro false', async () => {
    const profeA1 = await clientFor(profeAulaA1)
    const { data: r1 } = await profeA1.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioCentroA.centro_id,
      p_autor_id: anuncioCentroA.autor_id,
      p_ambito: 'centro',
      // El generador de tipos no refleja que la columna acepta NULL, pero la
      // función SQL maneja correctamente NULL para ámbito 'centro'.
      p_aula_id: null as unknown as string,
    })
    expect(r1).toBe(true)

    const tutorCon = await clientFor(tutorConPermisoNinoA1)
    const { data: r2 } = await tutorCon.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioCentroA.centro_id,
      p_autor_id: anuncioCentroA.autor_id,
      p_ambito: 'centro',
      // El generador de tipos no refleja que la columna acepta NULL, pero la
      // función SQL maneja correctamente NULL para ámbito 'centro'.
      p_aula_id: null as unknown as string,
    })
    expect(r2).toBe(true)

    const tutorSin = await clientFor(tutorSinPermisoNinoA1)
    const { data: r3 } = await tutorSin.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioCentroA.centro_id,
      p_autor_id: anuncioCentroA.autor_id,
      p_ambito: 'centro',
      // El generador de tipos no refleja que la columna acepta NULL, pero la
      // función SQL maneja correctamente NULL para ámbito 'centro'.
      p_aula_id: null as unknown as string,
    })
    expect(r3).toBe(false)

    const admin = await clientFor(adminA)
    const { data: r4 } = await admin.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioCentroA.centro_id,
      p_autor_id: anuncioCentroA.autor_id,
      p_ambito: 'centro',
      // El generador de tipos no refleja que la columna acepta NULL, pero la
      // función SQL maneja correctamente NULL para ámbito 'centro'.
      p_aula_id: null as unknown as string,
    })
    expect(r4).toBe(true)

    const profeB = await clientFor(profeCentroB) // usuario de otro centro
    const { data: r5 } = await profeB.rpc('usuario_es_audiencia_anuncio_row', {
      p_centro_id: anuncioCentroA.centro_id,
      p_autor_id: anuncioCentroA.autor_id,
      p_ambito: 'centro',
      // El generador de tipos no refleja que la columna acepta NULL, pero la
      // función SQL maneja correctamente NULL para ámbito 'centro'.
      p_aula_id: null as unknown as string,
    })
    expect(r5).toBe(false)
  })

  // -------------------------------------------------------------------
  // usuario_es_audiencia_anuncio (versión legacy por id) — sigue funcionando
  // para evaluaciones sobre filas pre-existentes (e.g., lectura_anuncio).
  // -------------------------------------------------------------------

  it('usuario_es_audiencia_anuncio(id) — equivale al row-aware sobre filas pre-existentes', async () => {
    const profeA1 = await clientFor(profeAulaA1)
    const { data: r1 } = await profeA1.rpc('usuario_es_audiencia_anuncio', {
      p_anuncio_id: anuncioAulaA1.id,
    })
    expect(r1).toBe(true)

    const profeB = await clientFor(profeCentroB)
    const { data: r2 } = await profeB.rpc('usuario_es_audiencia_anuncio', {
      p_anuncio_id: anuncioAulaA1.id, // otro centro
    })
    expect(r2).toBe(false)

    // Anuncio aula de centroB: profe de centroB lo recibe; profe de centroA no.
    const { data: r3 } = await profeB.rpc('usuario_es_audiencia_anuncio', {
      p_anuncio_id: anuncioAulaB1.id,
    })
    expect(r3).toBe(true)

    const { data: r4 } = await profeA1.rpc('usuario_es_audiencia_anuncio', {
      p_anuncio_id: anuncioAulaB1.id,
    })
    expect(r4).toBe(false)
  })
})
