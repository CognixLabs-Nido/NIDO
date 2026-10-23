import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-3 (`20261108120000`) — no se valida un recibo con el desborde de beca pendiente.
 *
 *  - El exceso de beca es dinero de la familia: con el recibo validado no iba a ningún sitio.
 *  - `confirmar_recibo` lo rechaza (HINT `desborde_pendiente`), y el mes no se cierra.
 *  - Por otro camino tampoco (trigger `recibos_validar_sin_desborde`), ni con service_role.
 *  - El resto del borrador se sigue editando, y resuelto el desborde se valida como siempre.
 *
 * UN MES POR TEST: validar el último borrador de un mes lo cierra.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

describe('PR-3 — validar con el desborde de beca pendiente', () => {
  let centro: { id: string }
  let familia: string
  let directora: TestUser
  let cDirectora: SupabaseClient<Database>

  async function borrador(mes: number, over: Partial<Recibo> = {}): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes,
        estado: 'borrador',
        metodo: 'efectivo',
        total_centimos: 0,
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  async function conDesborde(mes: number): Promise<string> {
    const id = await borrador(mes)
    const { error } = await serviceClient.from('beca_comedor_desborde').insert({
      centro_id: centro.id,
      recibo_id: id,
      familia_id: familia,
      anio: 2026,
      mes,
      cuota_total_centimos: 10000,
      beca_total_centimos: 12500,
      exceso_centimos: 2500,
      estado: 'pendiente',
    })
    if (error) throw new Error(`desborde: ${error.message}`)
    return id
  }

  function confirmar(id: string) {
    return cDirectora.rpc('confirmar_recibo', { p_recibo_id: id })
  }

  async function estado(id: string) {
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    return data?.estado
  }

  async function mesCerrado(mes: number) {
    const { data } = await serviceClient
      .from('cierre_mensual')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', 2026)
      .eq('mes', mes)
    return (data ?? []).length > 0
  }

  async function resolver(id: string) {
    const { error } = await cDirectora
      .from('beca_comedor_desborde')
      .update({
        estado: 'resuelto',
        via: 'transferencia',
        resuelto_por: directora.id,
        resuelto_at: new Date().toISOString(),
      })
      .eq('recibo_id', id)
    if (error) throw new Error(`resolver: ${error.message}`)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Validar Desborde PR3')
    const nino = await createTestNino(centro.id, 'Nino Validar Desborde')
    familia = nino.familia_id
    directora = await createTestUser({ nombre: 'Directora Validar Desborde' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('premisa: sin desborde, la directora valida y, siendo el último borrador, el mes se cierra', async () => {
    const id = await borrador(1)
    const { data, error } = await confirmar(id)
    expect(error).toBeNull()
    expect(data).toBe(true)
    expect(await estado(id)).toBe('pendiente_procesar')
    expect(await mesCerrado(1)).toBe(true)
  })

  it('con el desborde pendiente, confirmar_recibo no valida y el mes no se cierra', async () => {
    const id = await conDesborde(2)
    // Premisa: la directora ve el desborde (lo que el panel le enseña).
    const { data: visto } = await cDirectora
      .from('beca_comedor_desborde')
      .select('exceso_centimos, estado')
      .eq('recibo_id', id)
      .single()
    expect(visto).toEqual({ exceso_centimos: 2500, estado: 'pendiente' })

    const { error } = await confirmar(id)
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('desborde_pendiente')
    expect(error?.message).toContain('2500')
    expect(await estado(id)).toBe('borrador')
    expect(await mesCerrado(2)).toBe(false)
  })

  it('por otro camino que no sea la función tampoco se valida (la directora y service_role)', async () => {
    const id = await conDesborde(3)
    for (const cliente of [cDirectora, serviceClient]) {
      const { error } = await cliente
        .from('recibos')
        .update({ estado: 'pendiente_procesar' })
        .eq('id', id)
      expect(error?.hint).toBe('desborde_pendiente')
    }
    expect(await estado(id)).toBe('borrador')
  })

  it('el resto del borrador se sigue editando con el desborde pendiente', async () => {
    const id = await conDesborde(4)
    const { error } = await cDirectora
      .from('recibos')
      .update({ metodo: 'transferencia' })
      .eq('id', id)
    expect(error).toBeNull()
  })

  it('resuelto el desborde, se valida; y desconfirmar y volver a validar no lo estorba', async () => {
    const id = await conDesborde(5)
    await resolver(id)
    const { data, error } = await confirmar(id)
    expect(error).toBeNull()
    expect(data).toBe(true)
    expect(await mesCerrado(5)).toBe(true)

    expect((await cDirectora.rpc('desconfirmar_recibo', { p_recibo_id: id })).error).toBeNull()
    expect(await estado(id)).toBe('borrador')
    expect((await confirmar(id)).error).toBeNull()
    expect(await estado(id)).toBe('pendiente_procesar')
  })
})
