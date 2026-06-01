import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * Audit log automático sobre `recordatorios` (F6-A). El trigger
 * `audit_recordatorios` usa `audit_trigger_function()` con la rama nueva
 * (centro_id directo). Gated por `RECORDATORIOS_MIGRATION_APPLIED=1`.
 *
 * Verifica INSERT, UPDATE (completar) y UPDATE (anular) → cada uno genera su
 * fila en `audit_log` con el `centro_id` correcto.
 */
const MIGRATION_APPLIED = process.env.RECORDATORIOS_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('Audit log — recordatorios (F6)', () => {
  let centro: { id: string }
  let nino: { id: string }
  let autor: TestUser
  let recId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Rec')
    nino = await createTestNino(centro.id, 'Audit Rec')
    autor = await createTestUser({ nombre: 'Autor Audit Rec' })
  }, 60_000)

  afterAll(async () => {
    if (recId) await serviceClient.from('recordatorios').delete().eq('id', recId)
    if (autor?.id) await deleteTestUser(autor.id)
    if (centro?.id) await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT genera audit_log con centro_id directo', async () => {
    const { data: rec, error } = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'familia_individual',
        nino_id: nino.id,
        creado_por: autor.id,
        titulo: 'audit insert',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    recId = rec!.id

    const { data, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('accion, centro_id, valores_antes, valores_despues')
      .eq('tabla', 'recordatorios')
      .eq('registro_id', recId)
      .eq('accion', 'INSERT')
      .single()
    expect(auditErr).toBeNull()
    expect(data?.accion).toBe('INSERT')
    expect(data?.centro_id).toBe(centro.id)
    expect(data?.valores_antes).toBeNull()
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(despues?.titulo).toBe('audit insert')
  })

  it('UPDATE (completar) captura valores_antes y valores_despues', async () => {
    await serviceClient
      .from('recordatorios')
      .update({ completado_en: new Date().toISOString(), completado_por: autor.id })
      .eq('id', recId)

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'recordatorios')
      .eq('registro_id', recId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.centro_id).toBe(centro.id)
    const antes = data?.valores_antes as Record<string, unknown> | null
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(antes?.completado_en).toBeNull()
    expect(despues?.completado_en).not.toBeNull()
  })
})
