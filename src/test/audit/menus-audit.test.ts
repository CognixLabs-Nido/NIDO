import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, deleteTestCentro, serviceClient } from '../rls/setup'

/**
 * Audit log automático sobre plantillas_menu y plantilla_menu_dia (Fase 4.5).
 * audit_trigger_function() extiende dos ramas:
 *  - plantillas_menu  → centro_id directo
 *  - plantilla_menu_dia → centro_id derivado vía centro_de_plantilla()
 */

describe('Audit log — menús (Fase 4.5)', () => {
  let centro: { id: string }
  let plantillaId: string
  let diaId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Menus')
  }, 60_000)

  afterAll(async () => {
    if (diaId) await serviceClient.from('plantilla_menu_dia').delete().eq('id', diaId)
    if (plantillaId) await serviceClient.from('plantillas_menu').delete().eq('id', plantillaId)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en plantillas_menu deja audit_log con accion=INSERT y centro_id correcto', async () => {
    const { data, error } = await serviceClient
      .from('plantillas_menu')
      .insert({
        centro_id: centro.id,
        nombre: 'Plantilla audit',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    plantillaId = data!.id

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_despues')
      .eq('tabla', 'plantillas_menu')
      .eq('registro_id', plantillaId)
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('INSERT')
    expect(audit?.centro_id).toBe(centro.id)
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(despues?.nombre).toBe('Plantilla audit')
  })

  it('UPDATE captura valores_antes y valores_despues en plantillas_menu', async () => {
    const { error: updateErr } = await serviceClient
      .from('plantillas_menu')
      .update({ nombre: 'Plantilla audit (renombrada)' })
      .eq('id', plantillaId)
    expect(updateErr).toBeNull()

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'plantillas_menu')
      .eq('registro_id', plantillaId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(auditErr).toBeNull()
    const antes = audit?.valores_antes as Record<string, unknown> | null
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(antes?.nombre).toBe('Plantilla audit')
    expect(despues?.nombre).toBe('Plantilla audit (renombrada)')
    expect(audit?.centro_id).toBe(centro.id)
  })

  it('INSERT en plantilla_menu_dia deriva centro_id vía centro_de_plantilla()', async () => {
    const { data, error } = await serviceClient
      .from('plantilla_menu_dia')
      .insert({
        plantilla_id: plantillaId,
        dia_semana: 'lunes',
        comida: 'Lentejas con verduras',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    diaId = data!.id

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id')
      .eq('tabla', 'plantilla_menu_dia')
      .eq('registro_id', diaId)
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('INSERT')
    expect(audit?.centro_id).toBe(centro.id)
  })
})
