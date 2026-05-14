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
 * RLS de `datos_pedagogicos_nino` (Fase 2.6).
 *
 * Verifica que:
 *  - admin de centro A no ve datos del centro B,
 *  - profe del aula actual del niño puede leer,
 *  - profe de otra aula no puede leer,
 *  - tutor con `puede_ver_datos_pedagogicos=true` puede leer,
 *  - tutor sin permiso no puede leer.
 */
describe('RLS datos_pedagogicos_nino — aislamiento entre centros y permisos', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA: { id: string }
  let aulaB: { id: string }
  let aulaOtra: { id: string }
  let ninoA: { id: string }
  let ninoB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let profeAula: TestUser
  let profeOtra: TestUser
  let tutorConPermiso: TestUser
  let tutorSinPermiso: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Pedagógico A')
    centroB = await createTestCentro('Centro Pedagógico B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula A1')
    aulaOtra = await createTestAula(centroA.id, cursoA.id, 'Aula A2')
    aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula B1')

    ninoA = await createTestNino(centroA.id, 'Niño A')
    ninoB = await createTestNino(centroB.id, 'Niño B')

    await matricular(ninoA.id, aulaA.id, cursoA.id)
    await matricular(ninoB.id, aulaB.id, cursoB.id)

    // Datos pedagógicos para ambos niños (creados con service role, bypass RLS).
    await serviceClient.from('datos_pedagogicos_nino').insert([
      {
        nino_id: ninoA.id,
        lactancia_estado: 'materna',
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      },
      {
        nino_id: ninoB.id,
        lactancia_estado: 'finalizada',
        control_esfinteres: 'sin_panal_total',
        tipo_alimentacion: 'vegetariana',
        idiomas_casa: ['es', 'en'],
        tiene_hermanos_en_centro: false,
      },
    ])

    adminA = await createTestUser({ nombre: 'Admin A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    adminB = await createTestUser({ nombre: 'Admin B' })
    await asignarRol(adminB.id, centroB.id, 'admin')

    profeAula = await createTestUser({ nombre: 'Profe del aula' })
    await asignarRol(profeAula.id, centroA.id, 'profe')
    await asignarProfeAula(profeAula.id, aulaA.id)

    profeOtra = await createTestUser({ nombre: 'Profe de otra aula' })
    await asignarRol(profeOtra.id, centroA.id, 'profe')
    await asignarProfeAula(profeOtra.id, aulaOtra.id)

    tutorConPermiso = await createTestUser({ nombre: 'Tutor con permiso' })
    await asignarRol(tutorConPermiso.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorConPermiso.id, 'tutor_legal_principal', {
      puede_ver_datos_pedagogicos: true,
    })

    tutorSinPermiso = await createTestUser({ nombre: 'Tutor sin permiso' })
    await asignarRol(tutorSinPermiso.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorSinPermiso.id, 'tutor_legal_secundario', {
      puede_ver_datos_pedagogicos: false,
    })
  }, 90_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      adminB?.id,
      profeAula?.id,
      profeOtra?.id,
      tutorConPermiso?.id,
      tutorSinPermiso?.id,
    ].filter((u): u is string => Boolean(u))

    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)

    await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA.id, aulaOtra.id, aulaB.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 60_000)

  it('admin del centro A NO ve datos pedagógicos del centro B', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('datos_pedagogicos_nino')
      .select('nino_id')
      .eq('nino_id', ninoB.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('profe del aula del niño puede leer sus datos pedagógicos', async () => {
    const client = await clientFor(profeAula)
    const { data, error } = await client
      .from('datos_pedagogicos_nino')
      .select('nino_id, lactancia_estado')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('profe de OTRA aula del mismo centro NO ve los datos pedagógicos', async () => {
    const client = await clientFor(profeOtra)
    const { data, error } = await client
      .from('datos_pedagogicos_nino')
      .select('nino_id')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('tutor con permiso puede_ver_datos_pedagogicos lee la fila', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data, error } = await client
      .from('datos_pedagogicos_nino')
      .select('lactancia_estado')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('tutor sin permiso puede_ver_datos_pedagogicos NO lee la fila', async () => {
    const client = await clientFor(tutorSinPermiso)
    const { data, error } = await client
      .from('datos_pedagogicos_nino')
      .select('lactancia_estado')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })
})
