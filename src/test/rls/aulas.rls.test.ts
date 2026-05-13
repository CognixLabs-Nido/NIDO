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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

describe('RLS aulas/ninos — profe solo ve niños de sus aulas', () => {
  let centro: { id: string; nombre: string }
  let curso: { id: string; centro_id: string }
  let aulaA: { id: string }
  let aulaB: { id: string }
  let ninoEnA: { id: string }
  let ninoEnB: { id: string }
  let profeA: TestUser

  beforeAll(async () => {
    centro = await createTestCentro('Centro Aulas RLS')
    curso = await createTestCurso(centro.id)
    aulaA = await createTestAula(centro.id, curso.id, 'Aula A')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula B')
    ninoEnA = await createTestNino(centro.id, 'Niño A')
    ninoEnB = await createTestNino(centro.id, 'Niño B')
    await matricular(ninoEnA.id, aulaA.id, curso.id)
    await matricular(ninoEnB.id, aulaB.id, curso.id)
    profeA = await createTestUser({ nombre: 'Profe A' })
    await asignarRol(profeA.id, centro.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA.id)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('profes_aulas').delete().eq('profe_id', profeA.id)
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', profeA.id)
    await deleteTestUser(profeA.id)
    await serviceClient.from('matriculas').delete().in('nino_id', [ninoEnA.id, ninoEnB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoEnA.id, ninoEnB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA.id, aulaB.id])
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('profe asignado a aula A ve niño matriculado en A pero no en B', async () => {
    const client = await clientFor(profeA)
    const { data, error } = await client.from('ninos').select('id, nombre')
    expect(error).toBeNull()
    const ids = (data ?? []).map((n) => n.id)
    expect(ids).toContain(ninoEnA.id)
    expect(ids).not.toContain(ninoEnB.id)
  })

  it('profe ve solo la matrícula del aula A', async () => {
    const client = await clientFor(profeA)
    const { data, error } = await client.from('matriculas').select('id, aula_id')
    expect(error).toBeNull()
    const aulas = (data ?? []).map((m) => m.aula_id)
    expect(aulas).toContain(aulaA.id)
    expect(aulas).not.toContain(aulaB.id)
  })
})
