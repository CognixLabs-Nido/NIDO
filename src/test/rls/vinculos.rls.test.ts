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

describe('RLS vinculos_familiares — tutor solo ve sus niños', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let ninoTutorizado: { id: string }
  let ninoAjeno: { id: string }
  let tutor: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro Vinculos RLS')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    ninoTutorizado = await createTestNino(centro.id, 'Niño Vinculado')
    ninoAjeno = await createTestNino(centro.id, 'Niño Ajeno')
    await matricular(ninoTutorizado.id, aula.id, curso.id)
    await matricular(ninoAjeno.id, aula.id, curso.id)
    tutor = await createTestUser({ nombre: 'Tutor Legal Test' })
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoTutorizado.id, tutor.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
      puede_ver_fotos: true,
      puede_ver_info_medica: true,
    })
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('vinculos_familiares').delete().eq('usuario_id', tutor.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', tutor.id)
    await deleteTestUser(tutor.id)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoTutorizado.id, ninoAjeno.id])
    await serviceClient.from('ninos').delete().in('id', [ninoTutorizado.id, ninoAjeno.id])
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('tutor solo ve al niño vinculado, no a otros del centro', async () => {
    const client = await clientFor(tutor)
    const { data, error } = await client.from('ninos').select('id, nombre')
    expect(error).toBeNull()
    const ids = (data ?? []).map((n) => n.id)
    expect(ids).toContain(ninoTutorizado.id)
    expect(ids).not.toContain(ninoAjeno.id)
  })

  it('tutor ve solo su propio vínculo', async () => {
    const client = await clientFor(tutor)
    const { data, error } = await client.from('vinculos_familiares').select('id, nino_id')
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(1)
    const ninos = (data ?? []).map((v) => v.nino_id)
    expect(ninos).toContain(ninoTutorizado.id)
    expect(ninos).not.toContain(ninoAjeno.id)
  })
})
