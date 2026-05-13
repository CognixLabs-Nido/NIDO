import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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

describe('RLS info_medica_emergencia — permiso puede_ver_info_medica controla acceso', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let tutorConPermiso: TestUser
  let tutorSinPermiso: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro InfoMedica RLS')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Niño Médico')
    await matricular(nino.id, aula.id, curso.id)

    // Crea la fila médica usando service role (bypass RLS). En producción se
    // crea vía set_info_medica_emergencia_cifrada(...) que requiere ser admin.
    await serviceClient.from('info_medica_emergencia').insert({
      nino_id: nino.id,
      medicacion_habitual: 'Paracetamol gotas',
      alergias_leves: 'polen',
    })

    tutorConPermiso = await createTestUser({ nombre: 'Tutor con acceso' })
    await asignarRol(tutorConPermiso.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutorConPermiso.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })

    tutorSinPermiso = await createTestUser({ nombre: 'Tutor sin acceso' })
    await asignarRol(tutorSinPermiso.id, centro.id, 'tutor_legal')
    await crearVinculo(nino.id, tutorSinPermiso.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: false,
    })
  }, 60_000)

  afterAll(async () => {
    await serviceClient
      .from('vinculos_familiares')
      .delete()
      .in('usuario_id', [tutorConPermiso.id, tutorSinPermiso.id])
    await serviceClient
      .from('roles_usuario')
      .delete()
      .in('usuario_id', [tutorConPermiso.id, tutorSinPermiso.id])
    await deleteTestUser(tutorConPermiso.id)
    await deleteTestUser(tutorSinPermiso.id)
    await serviceClient.from('info_medica_emergencia').delete().eq('nino_id', nino.id)
    await serviceClient.from('matriculas').delete().eq('nino_id', nino.id)
    await serviceClient.from('ninos').delete().eq('id', nino.id)
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('tutor con permiso puede_ver_info_medica lee la fila', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data, error } = await client
      .from('info_medica_emergencia')
      .select('medicacion_habitual')
      .eq('nino_id', nino.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('tutor sin permiso puede_ver_info_medica no lee la fila', async () => {
    const client = await clientFor(tutorSinPermiso)
    const { data, error } = await client
      .from('info_medica_emergencia')
      .select('medicacion_habitual')
      .eq('nino_id', nino.id)
    expect(error).toBeNull()
    // RLS filtra silenciosamente: array vacío, no error.
    expect((data ?? []).length).toBe(0)
  })
})
