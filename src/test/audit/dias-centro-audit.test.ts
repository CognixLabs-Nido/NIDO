import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, deleteTestCentro, serviceClient } from '../rls/setup'

/**
 * Audit log automático sobre `dias_centro` (Fase 4.5a).
 *
 * `audit_trigger_function()` extendida con una rama nueva para
 * `dias_centro`: deriva `centro_id` directamente desde la fila (NEW/OLD),
 * sin pasar por `ninos`. Cada INSERT/UPDATE/DELETE deja una fila en
 * `audit_log`. El DELETE es especialmente importante: `dias_centro` es la
 * única tabla operativa donde permitimos DELETE (ADR-0019), y la
 * trazabilidad queda gracias a este trigger.
 */
describe('Audit log — dias_centro (F4.5a)', () => {
  let centro: { id: string }
  let diaInsertadoId: string | null = null
  let diaParaBorrarId: string | null = null

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit DiasCentro')
  }, 60_000)

  afterAll(async () => {
    // El INSERT del primer test sigue vivo y se limpia con el centro
    // (CASCADE). El día del DELETE ya está borrado. No hay nada más que
    // limpiar manualmente.
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en dias_centro graba audit_log con centro_id y valores_despues poblado', async () => {
    const { data, error } = await serviceClient
      .from('dias_centro')
      .insert({
        centro_id: centro.id,
        fecha: '2026-12-25',
        tipo: 'festivo',
        observaciones: 'Navidad',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    diaInsertadoId = data!.id

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_antes, valores_despues')
      .eq('tabla', 'dias_centro')
      .eq('registro_id', diaInsertadoId)
      .eq('accion', 'INSERT')
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('INSERT')
    expect(audit?.centro_id).toBe(centro.id)
    expect(audit?.valores_antes).toBeNull()
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(despues?.tipo).toBe('festivo')
    expect(despues?.observaciones).toBe('Navidad')
  })

  it('DELETE en dias_centro graba audit_log con valores_antes poblado y valores_despues null', async () => {
    // Crear un día específico para borrarlo y verificar el audit del DELETE.
    const { data: ins, error: insErr } = await serviceClient
      .from('dias_centro')
      .insert({
        centro_id: centro.id,
        fecha: '2026-01-06',
        tipo: 'festivo',
        observaciones: 'Reyes',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    diaParaBorrarId = ins!.id

    const { error: delErr } = await serviceClient
      .from('dias_centro')
      .delete()
      .eq('id', diaParaBorrarId)
    expect(delErr).toBeNull()

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'dias_centro')
      .eq('registro_id', diaParaBorrarId)
      .eq('accion', 'DELETE')
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('DELETE')
    expect(audit?.centro_id).toBe(centro.id)
    expect(audit?.valores_despues).toBeNull()
    const antes = audit?.valores_antes as Record<string, unknown> | null
    expect(antes?.tipo).toBe('festivo')
    expect(antes?.observaciones).toBe('Reyes')
  })
})
