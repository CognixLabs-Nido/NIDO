import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Los consentimientos solo se escriben por sus funciones, y miran de quién es el niño.
 *
 * Migración 20270104120000_fix_consentimientos_solo_por_funcion. Hasta ella, cualquiera con cuenta
 * daba el consentimiento de imagen de cualquier niño (y su flag `puede_aparecer_en_fotos` pasaba a
 * true) por dos caminos: el INSERT directo en la tabla (la policy solo miraba que la fila fuera a tu
 * nombre) y `registrar_consentimiento`, que aceptaba cualquier tipo y cualquier niño. Medido en
 * producción el 2026-11-06 en un ensayo terminado en RAISE.
 *
 * Tres cerrojos (el ensayo los mide uno a uno): la sesión no escribe la tabla; la policy de INSERT
 * mira `privado.puede_consentir`; las dos funciones la miran. Aquí, la regla entera, también con dos
 * centros, que en producción hoy no se puede probar.
 */
describe('Consentimientos: solo por sus funciones, y de quién es el niño', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let ninoA: TestNino
  let ninoB: TestNino
  let adminA: TestUser
  let adminB: TestUser
  let tutorA: TestUser // tutor legal de A, miembro del centro A
  let tutorB: TestUser // tutor legal de B (mismo centro), nada de A
  let tutorFuera: TestUser // vínculo legal con A, pero su rol vivo es del centro B
  let profe: TestUser

  const flagDe = async (ninoId: string): Promise<boolean | null> => {
    const { data } = await serviceClient
      .from('ninos')
      .select('puede_aparecer_en_fotos')
      .eq('id', ninoId)
      .single()
    return data?.puede_aparecer_en_fotos ?? null
  }
  const filasDe = async (ninoId: string, tipo: 'imagen' | 'datos_medicos') => {
    const { data } = await serviceClient
      .from('consentimientos')
      .select('usuario_id')
      .eq('nino_id', ninoId)
      .eq('tipo', tipo)
      .is('revocado_en', null)
    return (data ?? []).map((r) => r.usuario_id)
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Consent solo funcion A')
    centroB = await createTestCentro('Consent solo funcion B')
    ninoA = await createTestNino(centroA.id, 'Nino A Consent Funcion')
    ninoB = await createTestNino(centroA.id, 'Nino B Consent Funcion')
    adminA = await createTestUser({ nombre: 'Admin A Consent Funcion' })
    adminB = await createTestUser({ nombre: 'Admin B Consent Funcion' })
    tutorA = await createTestUser({ nombre: 'Tutor A Consent Funcion' })
    tutorB = await createTestUser({ nombre: 'Tutor B Consent Funcion' })
    tutorFuera = await createTestUser({ nombre: 'Tutor Fuera Consent Funcion' })
    profe = await createTestUser({ nombre: 'Profe Consent Funcion' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await asignarRol(tutorB.id, centroA.id, 'tutor_legal')
    await asignarRol(tutorFuera.id, centroB.id, 'tutor_legal')
    await asignarRol(profe.id, centroA.id, 'profe')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal')
    await crearVinculo(ninoA.id, tutorFuera.id, 'tutor_legal_secundario')
  }, 240_000)

  afterAll(async () => {
    const ninos = [ninoA, ninoB].filter(Boolean).map((n) => n.id)
    const usuarios = [adminA, adminB, tutorA, tutorB, tutorFuera, profe]
      .filter(Boolean)
      .map((u) => u.id)
    await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', ninos)
    await serviceClient.from('ninos').delete().in('id', ninos)
    for (const u of usuarios) await deleteTestUser(u)
    for (const c of [centroA, centroB].filter(Boolean)) await deleteTestCentro(c.id)
  }, 120_000)

  it('premisa: quién es quién', async () => {
    const cA = await clientFor(tutorA)
    const cB = await clientFor(tutorB)
    const cF = await clientFor(tutorFuera)
    expect((await cA.rpc('es_tutor_legal_de', { p_nino_id: ninoA.id })).data).toBe(true)
    expect((await cA.rpc('pertenece_a_centro', { p_centro_id: centroA.id })).data).toBe(true)
    expect((await cB.rpc('es_tutor_legal_de', { p_nino_id: ninoB.id })).data).toBe(true)
    expect((await cB.rpc('pertenece_a_centro', { p_centro_id: centroA.id })).data).toBe(true)
    expect((await cB.rpc('es_tutor_legal_de', { p_nino_id: ninoA.id })).data).toBe(false)
    // El de fuera: tutor legal de A, sin rol vivo en el centro de A.
    expect((await cF.rpc('es_tutor_legal_de', { p_nino_id: ninoA.id })).data).toBe(true)
    expect((await cF.rpc('pertenece_a_centro', { p_centro_id: centroA.id })).data).toBe(false)
    expect((await cF.rpc('pertenece_a_centro', { p_centro_id: centroB.id })).data).toBe(true)
    const cP = await clientFor(profe)
    expect((await cP.rpc('pertenece_a_centro', { p_centro_id: centroA.id })).data).toBe(true)
    expect(
      (await (await clientFor(adminB)).rpc('es_admin', { p_centro_id: centroA.id })).data
    ).toBe(false)
    expect(
      (await (await clientFor(adminA)).rpc('es_admin', { p_centro_id: centroA.id })).data
    ).toBe(true)
    expect(await flagDe(ninoA.id)).toBe(false)
    expect(await filasDe(ninoA.id, 'imagen')).toEqual([])
  })

  it('la tabla: nadie con sesión la escribe, tampoco el tutor legal (42501)', async () => {
    for (const u of [tutorB, profe, tutorA]) {
      const c = await clientFor(u)
      const { error } = await c
        .from('consentimientos')
        .insert({ usuario_id: u.id, tipo: 'imagen', version: 'v1', nino_id: ninoA.id })
      expect.soft(error?.code, u.email).toBe('42501')
    }
    expect(await flagDe(ninoA.id)).toBe(false)
    expect(await filasDe(ninoA.id, 'imagen')).toEqual([])
  })

  it('registrar_consentimiento no registra la imagen, para nadie (22023)', async () => {
    for (const u of [tutorB, tutorA]) {
      const c = await clientFor(u)
      const { error } = await c.rpc('registrar_consentimiento', {
        p_usuario_id: u.id,
        p_tipo: 'imagen',
        p_version: 'v1',
        p_nino_id: ninoA.id,
      })
      expect.soft(error?.code, u.email).toBe('22023')
      expect.soft(error?.hint, u.email).toBe('imagen')
    }
    expect(await flagDe(ninoA.id)).toBe(false)
  })

  it('el acuse médico de A: ni el tutor de otro niño, ni la profe, ni otro centro (42501)', async () => {
    for (const u of [tutorB, profe, adminB, tutorFuera]) {
      const c = await clientFor(u)
      const { error } = await c.rpc('registrar_consentimiento', {
        p_usuario_id: u.id,
        p_tipo: 'datos_medicos',
        p_version: 'v2.0',
        p_nino_id: ninoA.id,
      })
      expect.soft(error?.code, u.email).toBe('42501')
    }
    expect(await filasDe(ninoA.id, 'datos_medicos')).toEqual([])
  })

  it('control: el acuse médico de A lo registran su tutor legal y la Dirección de su centro', async () => {
    for (const u of [tutorA, adminA]) {
      const c = await clientFor(u)
      const { error } = await c.rpc('registrar_consentimiento', {
        p_usuario_id: u.id,
        p_tipo: 'datos_medicos',
        p_version: 'v2.0',
        p_nino_id: ninoA.id,
        p_metodo: u === adminA ? 'presencial' : 'digital',
      })
      expect.soft(error, u.email).toBeNull()
    }
    expect((await filasDe(ninoA.id, 'datos_medicos')).sort()).toEqual([tutorA.id, adminA.id].sort())
  })

  it('los de la cuenta van sin niño: con niño, 42501; sin él, control, entra', async () => {
    const c = await clientFor(tutorA)
    const conNino = await c.rpc('registrar_consentimiento', {
      p_usuario_id: tutorA.id,
      p_tipo: 'terminos',
      p_version: 'v1',
      p_nino_id: ninoA.id,
    })
    expect(conNino.error?.code).toBe('42501')
    const sinNino = await c.rpc('registrar_consentimiento', {
      p_usuario_id: tutorA.id,
      p_tipo: 'terminos',
      p_version: 'v1',
    })
    expect(sinNino.error).toBeNull()
  })

  it('el servidor también respeta la forma: de la cuenta sin niño, de un niño con él (22023)', async () => {
    const terminosConNino = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: tutorA.id,
      p_tipo: 'terminos',
      p_version: 'v1',
      p_nino_id: ninoA.id,
    })
    expect(terminosConNino.error?.code).toBe('22023')
    const medicoSinNino = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: tutorA.id,
      p_tipo: 'datos_medicos',
      p_version: 'v2.0',
    })
    expect(medicoSinNino.error?.code).toBe('22023')
    expect(medicoSinNino.error?.hint).toBe('nino_id')
  })

  it('otorgar la imagen de A: ni el tutor de otro niño, ni la profe, ni otro centro (42501)', async () => {
    for (const u of [tutorB, profe, adminB, tutorFuera]) {
      const c = await clientFor(u)
      const { error } = await c.rpc('otorgar_consentimiento_imagen', {
        p_nino_id: ninoA.id,
        p_tutor: u.id,
      })
      expect.soft(error?.code, u.email).toBe('42501')
    }
    expect(await flagDe(ninoA.id)).toBe(false)
    expect(await filasDe(ninoA.id, 'imagen')).toEqual([])
  })

  it('otorgar para un niño que no existe: tampoco la Dirección (42501)', async () => {
    const c = await clientFor(adminA)
    const { error } = await c.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: crypto.randomUUID(),
      p_tutor: tutorA.id,
    })
    expect(error?.code).toBe('42501')
  })

  it('control: su tutor legal la otorga, y el flag de A pasa a true (el de B no)', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: ninoA.id,
      p_tutor: tutorA.id,
    })
    expect(error).toBeNull()
    expect(await filasDe(ninoA.id, 'imagen')).toEqual([tutorA.id])
    expect(await flagDe(ninoA.id)).toBe(true)
    expect(await flagDe(ninoB.id)).toBe(false)
  })
})
