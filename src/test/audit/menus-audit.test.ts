import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, deleteTestCentro, serviceClient } from '../rls/setup'

/**
 * Audit log automático sobre plantillas_menu_mensual y menu_dia, más
 * verificación del trigger BEFORE INSERT/UPDATE en menu_dia que valida
 * "fecha dentro del mes/año de la plantilla padre".
 *
 * audit_trigger_function() extendida con 2 ramas nuevas:
 *  - plantillas_menu_mensual: centro_id directo.
 *  - menu_dia: derivado via centro_de_plantilla.
 */
describe('Audit log + trigger validar_fecha — F4.5b', () => {
  let centro: { id: string }
  let plantillaId: string | null = null

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Menus')
  }, 60_000)

  afterAll(async () => {
    // El CASCADE on delete del centro limpia plantillas y menu_dia.
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en plantillas_menu_mensual graba audit_log con centro_id correcto', async () => {
    const { data, error } = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({ centro_id: centro.id, mes: 9, anio: 2026, estado: 'borrador' })
      .select('id')
      .single()
    expect(error).toBeNull()
    plantillaId = data!.id

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_despues')
      .eq('tabla', 'plantillas_menu_mensual')
      .eq('registro_id', plantillaId)
      .eq('accion', 'INSERT')
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('INSERT')
    expect(audit?.centro_id).toBe(centro.id)
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(despues?.estado).toBe('borrador')
    expect(despues?.mes).toBe(9)
  })

  it('UPDATE en menu_dia graba audit_log con centro_id derivado vía centro_de_plantilla', async () => {
    expect(plantillaId).toBeTruthy()
    // INSERT inicial: fecha dentro del mes (sep 2026).
    const { data: ins, error: insErr } = await serviceClient
      .from('menu_dia')
      .insert({
        plantilla_id: plantillaId!,
        fecha: '2026-09-15',
        comida_primero: 'Macarrones',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    const menuDiaId = ins!.id

    // UPDATE: cambiamos comida_primero para verificar diff antes/después.
    const { error: updErr } = await serviceClient
      .from('menu_dia')
      .update({ comida_primero: 'Lentejas con verduras' })
      .eq('id', menuDiaId)
    expect(updErr).toBeNull()

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'menu_dia')
      .eq('registro_id', menuDiaId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('UPDATE')
    expect(audit?.centro_id).toBe(centro.id) // derivado via centro_de_plantilla
    const antes = audit?.valores_antes as Record<string, unknown> | null
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(antes?.comida_primero).toBe('Macarrones')
    expect(despues?.comida_primero).toBe('Lentejas con verduras')
  })

  it('trigger validar_fecha rechaza INSERT con fecha fuera del mes de la plantilla', async () => {
    expect(plantillaId).toBeTruthy()
    // Plantilla es mes=9 anio=2026. Intentamos meter una fecha de octubre.
    const { data, error } = await serviceClient
      .from('menu_dia')
      .insert({
        plantilla_id: plantillaId!,
        fecha: '2026-10-15',
        comida_primero: 'Esto NO debería entrar',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
    // El RAISE EXCEPTION del trigger lleva ERRCODE 'check_violation'.
    // Postgres lo expone como '23514' a la capa cliente.
    expect((error as { code?: string })?.code).toBe('23514')
  })

  it('trigger validar_fecha rechaza UPDATE que mueve la fecha fuera del mes', async () => {
    expect(plantillaId).toBeTruthy()
    // Crear una fila válida en septiembre.
    const { data: ins } = await serviceClient
      .from('menu_dia')
      .insert({
        plantilla_id: plantillaId!,
        fecha: '2026-09-22',
        comida_primero: 'Pescado',
      })
      .select('id')
      .single()
    const menuDiaId = ins!.id

    // Intentar mover la fecha a otro mes.
    const { error } = await serviceClient
      .from('menu_dia')
      .update({ fecha: '2026-11-22' })
      .eq('id', menuDiaId)
    expect(error).not.toBeNull()
    expect((error as { code?: string })?.code).toBe('23514')
  })
})
