import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, deleteTestCentro, serviceClient } from './setup'

/**
 * Tests de los helpers SQL `tipo_de_dia` y `centro_abierto` (Fase 4.5a).
 *
 * Verifica que:
 *  - Sin override, lunes-viernes → 'lectivo', sábado-domingo → 'cerrado'.
 *  - Con override, devuelve el tipo persistido.
 *  - `centro_abierto` es false para festivo y true para escuela_verano.
 *
 * Las queries usan service role para invocar las funciones RPC (las
 * functions son SECURITY DEFINER, así que la respuesta es la misma).
 */
describe('tipo_de_dia / centro_abierto — helpers SQL', () => {
  let centro: { id: string }
  const diasCreados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro tipo_de_dia')
  }, 60_000)

  afterAll(async () => {
    if (diasCreados.length > 0) {
      await serviceClient.from('dias_centro').delete().in('id', diasCreados)
    }
    await deleteTestCentro(centro.id)
  }, 60_000)

  it("lunes sin override → 'lectivo'", async () => {
    // 2026-06-15 es lunes.
    const { data, error } = await serviceClient.rpc('tipo_de_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-06-15',
    })
    expect(error).toBeNull()
    expect(data).toBe('lectivo')
  })

  it("domingo sin override → 'cerrado'", async () => {
    // 2026-06-14 es domingo.
    const { data, error } = await serviceClient.rpc('tipo_de_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-06-14',
    })
    expect(error).toBeNull()
    expect(data).toBe('cerrado')
  })

  it("lunes con override 'festivo' → 'festivo' (override gana)", async () => {
    const { data: ins, error: insErr } = await serviceClient
      .from('dias_centro')
      .insert({
        centro_id: centro.id,
        fecha: '2026-06-22',
        tipo: 'festivo',
        observaciones: 'Test festivo en lunes',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    if (ins?.id) diasCreados.push(ins.id)

    const { data, error } = await serviceClient.rpc('tipo_de_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-06-22',
    })
    expect(error).toBeNull()
    expect(data).toBe('festivo')
  })

  it('centro_abierto: festivo → false; escuela_verano → true', async () => {
    // El día 2026-06-22 ya está marcado como festivo arriba.
    const { data: cerradoData, error: cerradoErr } = await serviceClient.rpc('centro_abierto', {
      p_centro_id: centro.id,
      p_fecha: '2026-06-22',
    })
    expect(cerradoErr).toBeNull()
    expect(cerradoData).toBe(false)

    // Marcar un día como escuela_verano y verificar abierto.
    const { data: ins, error: insErr } = await serviceClient
      .from('dias_centro')
      .insert({
        centro_id: centro.id,
        fecha: '2026-08-15',
        tipo: 'escuela_verano',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    if (ins?.id) diasCreados.push(ins.id)

    const { data: abiertoData, error: abiertoErr } = await serviceClient.rpc('centro_abierto', {
      p_centro_id: centro.id,
      p_fecha: '2026-08-15',
    })
    expect(abiertoErr).toBeNull()
    expect(abiertoData).toBe(true)
  })
})
