import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * La fecha de cobro del recibo (`20261214120000`, F1 de «La fecha de cobro» en
 * `docs/specs/altas-serie.md`), contra la BD real.
 *
 *  - Dirección pone la misma fecha (o la quita) a muchos recibos de una vez, todos o ninguno.
 *  - La fecha solo cambia en borrador o pendiente y fuera de una remesa enviada o con el fichero
 *    generado: así la misma versión del fichero no cambia de fecha entre dos descargas. El trigger
 *    vale para todos, también service_role.
 *  - Otro centro, una profe, un recibo que no es por banco y una lista mal formada no cambian nada.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ANIO = 2026
const MES = 4
const EL_5 = '2026-05-05'

describe('La fecha de cobro del recibo', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let familiaOtro: string
  let directora: TestUser
  let profe: TestUser
  let cDirectora: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>

  async function recibo(over: Partial<Recibo> = {}): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: ANIO,
        mes: MES,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Fecha de cobro',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  async function remesaCon(reciboIds: string[]): Promise<string> {
    const { data, error } = await cDirectora
      .from('remesas')
      .insert({ centro_id: centro.id, anio: ANIO, mes: MES })
      .select('id')
      .single()
    if (error || !data) throw new Error(`remesa: ${error?.message}`)
    for (const r of reciboIds) {
      const { error: e } = await cDirectora
        .from('recibos_remesa')
        .insert({ centro_id: centro.id, remesa_id: data.id, recibo_id: r })
      if (e) throw new Error(`enlace: ${e.message}`)
    }
    return data.id
  }

  function fijar(
    cliente: SupabaseClient<Database>,
    ids: string[],
    fecha: string | null,
    c = centro.id
  ) {
    return cliente.rpc('fijar_fecha_cobro_recibos', {
      p_centro_id: c,
      p_recibo_ids: ids,
      p_fecha: fecha as string,
    })
  }

  async function fechas(ids: string[]): Promise<Record<string, string | null>> {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, fecha_cobro_banco')
      .in('id', ids)
    return Object.fromEntries((data ?? []).map((r) => [r.id, r.fecha_cobro_banco]))
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Fecha Cobro')
    otroCentro = await createTestCentro('Otro Centro Fecha Cobro')
    familia = await createTestFamilia(centro.id)
    familiaOtro = await createTestFamilia(otroCentro.id)

    directora = await createTestUser({ nombre: 'Directora Fecha Cobro' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
    profe = await createTestUser({ nombre: 'Profe Fecha Cobro' })
    await asignarRol(profe.id, centro.id, 'profe')
    cProfe = await clientFor(profe)
  }, 120_000)

  afterAll(async () => {
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    await deleteTestUser(directora.id)
    await deleteTestUser(profe.id)
  }, 120_000)

  it('Dirección pone «el 5» a varios recibos de una vez, y repetirlo no cambia nada', async () => {
    const a = await recibo()
    const b = await recibo()
    // Premisa: los dos nacen sin fecha.
    expect(await fechas([a, b])).toEqual({ [a]: null, [b]: null })

    const r = await fijar(cDirectora, [a, b], EL_5)
    expect(r.error).toBeNull()
    expect(r.data).toEqual(
      expect.arrayContaining([
        { recibo_id: a, resultado: 'cambiada' },
        { recibo_id: b, resultado: 'cambiada' },
      ])
    )
    expect(await fechas([a, b])).toEqual({ [a]: EL_5, [b]: EL_5 })

    const otra = await fijar(cDirectora, [a, b], EL_5)
    expect(otra.data?.map((x) => x.resultado)).toEqual(['sin_cambio', 'sin_cambio'])

    // Quitarla (NULL) vuelve a dejarlo sin fecha.
    expect((await fijar(cDirectora, [a], null)).error).toBeNull()
    expect((await fechas([a]))[a]).toBeNull()
  })

  it('el cambio queda en audit_log con quien lo hizo', async () => {
    const a = await recibo()
    expect((await fijar(cDirectora, [a], EL_5)).error).toBeNull()
    const { data } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'recibos')
      .eq('registro_id', a)
      .eq('accion', 'UPDATE')
    const fila = (data ?? []).find(
      (f) => (f.valores_despues as Record<string, unknown> | null)?.fecha_cobro_banco === EL_5
    )
    expect(fila?.usuario_id).toBe(directora.id)
  })

  it('en una remesa en borrador sin fichero cambia; con el fichero generado, no, y la lista entera falla', async () => {
    const dentro = await recibo()
    const fuera = await recibo()
    const remesa = await remesaCon([dentro])
    // Premisa: sin marca, la fecha cambia.
    expect((await fijar(cDirectora, [dentro], EL_5)).error).toBeNull()

    const marca = await cDirectora
      .from('remesas')
      .update({ fichero_generado_at: new Date().toISOString() })
      .eq('id', remesa)
      .select('id')
      .maybeSingle()
    expect(marca.data).not.toBeNull()

    // `fuera` iría bien solo; con `dentro` en la lista, no cambia ninguno.
    const r = await fijar(cDirectora, [fuera, dentro], '2026-05-06')
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.hint).toBe('fecha_cobro_en_fichero')
    expect(await fechas([dentro, fuera])).toEqual({ [dentro]: EL_5, [fuera]: null })

    // Tampoco con service_role, directamente.
    const directo = await serviceClient
      .from('recibos')
      .update({ fecha_cobro_banco: '2026-05-06' })
      .eq('id', dentro)
    expect(directo.error?.hint).toBe('fecha_cobro_en_fichero')
  })

  it('un recibo enviado al banco o cobrado no cambia de fecha, tampoco con service_role', async () => {
    const enviado = await recibo()
    const remesa = await remesaCon([enviado])
    expect(
      (
        await cDirectora
          .from('remesas')
          .update({ estado: 'enviada', fecha_envio_banco: '2026-04-20' })
          .eq('id', remesa)
      ).error
    ).toBeNull()
    expect(
      (
        await cDirectora
          .from('recibos')
          .update({ estado: 'enviado_banco', fecha_envio_banco: '2026-04-20' })
          .eq('id', enviado)
      ).error
    ).toBeNull()

    const r = await fijar(cDirectora, [enviado], EL_5)
    expect(r.error?.hint).toBe('fecha_cobro_recibo_cerrado')
    const directo = await serviceClient
      .from('recibos')
      .update({ fecha_cobro_banco: EL_5 })
      .eq('id', enviado)
    expect(directo.error?.hint).toBe('fecha_cobro_recibo_cerrado')
    expect((await fechas([enviado]))[enviado]).toBeNull()

    // Cobrado a mano y FUERA de toda remesa: aquí solo frena el estado. El enviado de arriba está
    // además en una remesa enviada, y lo frena también la otra defensa (medido: sin la del estado,
    // ese caso seguía en rojo por la remesa).
    const cobrado = await recibo({ metodo: 'efectivo' })
    const cobro = await cDirectora
      .from('recibos')
      .update({ estado: 'cobrado_manual', cobro_forma: 'efectivo', cobro_fecha: '2026-04-21' })
      .eq('id', cobrado)
      .select('estado')
      .maybeSingle()
    // Premisa: cobrado y en ninguna remesa.
    expect(cobro.data?.estado).toBe('cobrado_manual')
    const { data: enlaces } = await serviceClient
      .from('recibos_remesa')
      .select('id')
      .eq('recibo_id', cobrado)
    expect(enlaces).toEqual([])
    const directoCobrado = await serviceClient
      .from('recibos')
      .update({ fecha_cobro_banco: EL_5 })
      .eq('id', cobrado)
    expect(directoCobrado.error?.hint).toBe('fecha_cobro_recibo_cerrado')
    expect((await fechas([cobrado]))[cobrado]).toBeNull()
  })

  it('otro centro, una profe, un recibo que no es por banco y una lista mal formada no cambian nada', async () => {
    const mio = await recibo()
    const deOtro = await recibo({ centro_id: otroCentro.id, familia_id: familiaOtro })
    const efectivo = await recibo({ metodo: 'efectivo' })

    // Premisa: la directora sí puede con su recibo solo.
    expect((await fijar(cDirectora, [mio], EL_5)).error).toBeNull()
    expect((await fijar(cDirectora, [mio], null)).error).toBeNull()

    expect((await fijar(cDirectora, [mio, deOtro], EL_5)).error?.code).toBe('42501')
    expect((await fijar(cDirectora, [deOtro], EL_5, otroCentro.id)).error?.code).toBe('42501')
    expect((await fijar(cProfe, [mio], EL_5)).error?.code).toBe('42501')
    const noSepa = await fijar(cDirectora, [mio, efectivo], EL_5)
    expect(noSepa.error?.hint).toBe('recibo_no_sepa')
    expect((await fijar(cDirectora, [], EL_5)).error?.code).toBe('22023')
    expect((await fijar(cDirectora, [mio, mio], EL_5)).error?.code).toBe('22023')

    expect(await fechas([mio, deOtro, efectivo])).toEqual({
      [mio]: null,
      [deOtro]: null,
      [efectivo]: null,
    })
  })
})
