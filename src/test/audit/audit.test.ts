import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  deleteTestCentro,
  matricular,
  serviceClient,
} from '../rls/setup'

describe('Audit log automático — captura INSERT/UPDATE/soft-delete', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let matriculaId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Flow')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
  }, 60_000)

  afterAll(async () => {
    if (matriculaId) {
      await serviceClient.from('matriculas').delete().eq('id', matriculaId)
    }
    if (nino?.id) {
      await serviceClient.from('ninos').delete().eq('id', nino.id)
    }
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en ninos genera fila audit_log con accion=INSERT y centro_id derivado', async () => {
    nino = await createTestNino(centro.id, 'Audit Insert')
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_despues, valores_antes')
      .eq('tabla', 'ninos')
      .eq('registro_id', nino.id)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('INSERT')
    expect(data?.centro_id).toBe(centro.id)
    expect(data?.valores_antes).toBeNull()
    expect(data?.valores_despues).toBeTruthy()
  })

  it('UPDATE en ninos captura valores_antes y valores_despues', async () => {
    const { error: updateError } = await serviceClient
      .from('ninos')
      .update({ notas_admin: 'Nota nueva tras update' })
      .eq('id', nino.id)
    expect(updateError).toBeNull()

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues')
      .eq('tabla', 'ninos')
      .eq('registro_id', nino.id)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('UPDATE')
    const antes = data?.valores_antes as Record<string, unknown> | null
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(antes?.notas_admin).toBeNull()
    expect(despues?.notas_admin).toBe('Nota nueva tras update')
  })

  it('soft delete via deleted_at se audita como UPDATE', async () => {
    matriculaId = await matricular(nino.id, aula.id, curso.id)
    const { error: deleteError } = await serviceClient
      .from('matriculas')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', matriculaId)
    expect(deleteError).toBeNull()

    const { data } = await serviceClient
      .from('audit_log')
      .select('accion, valores_despues')
      .eq('tabla', 'matriculas')
      .eq('registro_id', matriculaId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(data?.accion).toBe('UPDATE')
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(despues?.deleted_at).not.toBeNull()
  })
})
