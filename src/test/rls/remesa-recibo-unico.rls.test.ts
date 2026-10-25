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
 * Un recibo, una remesa (`20261120120000`), contra la BD real.
 *
 *  - Un recibo no entra en dos remesas vivas, por ningún camino ni a la vez: eso lo cobraría dos
 *    veces en el banco. Tampoco con service_role. El de una remesa borrada sí vuelve a entrar.
 *  - A una remesa en borrador se le añaden recibos mientras no se haya generado su fichero. Con el
 *    fichero generado, o enviada, ni entra ni sale ninguno, y la marca del fichero no se quita.
 *  - Solo entran recibos por banco, confirmados, con importe y del centro de la remesa.
 *  - Una remesa enviada no vuelve a borrador, y ni la enviada ni la que tiene fichero se borran: sus
 *    recibos quedarían libres para otra remesa.
 *  - Un recibo en una remesa viva no vuelve a borrador por ningún camino, y el enlace no se mueve.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ANIO = 2026
const MES = 3

describe('Un recibo, una remesa', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let familiaOtro: string
  let directora: TestUser
  let cDirectora: SupabaseClient<Database>

  async function recibo(over: Partial<Recibo> = {}): Promise<string> {
    // Esporádico: el índice de un recibo regular por familia y mes no deja más de uno.
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
        concepto_esporadico: 'Remesa única',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  async function remesa(): Promise<string> {
    const { data, error } = await cDirectora
      .from('remesas')
      .insert({ centro_id: centro.id, anio: ANIO, mes: MES })
      .select('id')
      .single()
    if (error || !data) throw new Error(`remesa: ${error?.message}`)
    return data.id
  }

  function enlazar(cliente: SupabaseClient<Database>, remesaId: string, reciboId: string) {
    return cliente
      .from('recibos_remesa')
      .insert({ centro_id: centro.id, remesa_id: remesaId, recibo_id: reciboId })
      .select('id')
      .maybeSingle()
  }

  async function enlaces(reciboId: string): Promise<string[]> {
    const { data } = await serviceClient
      .from('recibos_remesa')
      .select('remesa_id')
      .eq('recibo_id', reciboId)
    return (data ?? []).map((e) => e.remesa_id)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Remesa Recibo Unico')
    otroCentro = await createTestCentro('Otro Centro Remesa Recibo Unico')
    familia = await createTestFamilia(centro.id)
    familiaOtro = await createTestFamilia(otroCentro.id)

    directora = await createTestUser({ nombre: 'Directora Remesa Recibo Unico' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
  }, 120_000)

  afterAll(async () => {
    for (const c of [centro, otroCentro]) {
      // Los enlaces primero: su FK a recibos es ON DELETE RESTRICT. Con service_role, que es el
      // único que suelta un recibo de una remesa enviada.
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    await deleteTestUser(directora.id)
  }, 120_000)

  it('un recibo no entra en una segunda remesa viva, tampoco con service_role', async () => {
    const id = await recibo()
    const primera = await remesa()
    const segunda = await remesa()

    // Premisa: el recibo entra en la primera.
    expect((await enlazar(cDirectora, primera, id)).error).toBeNull()
    expect(await enlaces(id)).toEqual([primera])

    const directa = await enlazar(cDirectora, segunda, id)
    expect(directa.error?.code).toBe('P0001')
    expect(directa.error?.hint).toBe('recibo_en_otra_remesa')
    const servicio = await enlazar(serviceClient, segunda, id)
    expect(servicio.error?.hint).toBe('recibo_en_otra_remesa')
    expect(await enlaces(id)).toEqual([primera])
  })

  it('dos remesas a la vez con el mismo recibo: entra en una sola', async () => {
    const id = await recibo()
    const a = await remesa()
    const b = await remesa()

    const [ra, rb] = await Promise.all([enlazar(cDirectora, a, id), enlazar(cDirectora, b, id)])
    const errores = [ra.error, rb.error].filter((e) => e !== null)
    expect(errores).toHaveLength(1)
    expect(await enlaces(id)).toHaveLength(1)
  })

  it('a una remesa en borrador se le añaden recibos', async () => {
    const r = await remesa()
    const uno = await recibo()
    const dos = await recibo()
    expect((await enlazar(cDirectora, r, uno)).error).toBeNull()

    expect((await enlazar(cDirectora, r, dos)).error).toBeNull()
    const { count } = await serviceClient
      .from('recibos_remesa')
      .select('id', { count: 'exact', head: true })
      .eq('remesa_id', r)
    expect(count).toBe(2)
  })

  it('una remesa enviada ni admite recibos ni los suelta', async () => {
    const r = await remesa()
    const dentro = await recibo()
    expect((await enlazar(cDirectora, r, dentro)).error).toBeNull()
    const enviada = await cDirectora
      .from('remesas')
      .update({ estado: 'enviada', fecha_envio_banco: '2026-03-05' })
      .eq('id', r)
      .select('id')
      .maybeSingle()
    expect(enviada.error).toBeNull()
    expect(enviada.data).not.toBeNull()

    const nuevo = await enlazar(cDirectora, r, await recibo())
    expect(nuevo.error?.hint).toBe('remesa_cerrada')
    const suelta = await cDirectora.from('recibos_remesa').delete().eq('recibo_id', dentro)
    expect(suelta.error?.hint).toBe('remesa_cerrada')
    expect(await enlaces(dentro)).toEqual([r])
  })

  it('con el fichero generado, ni entra ni sale ningún recibo, y la marca no se quita', async () => {
    const r = await remesa()
    const dentro = await recibo()
    expect((await enlazar(cDirectora, r, dentro)).error).toBeNull()
    const marca = await cDirectora
      .from('remesas')
      .update({ fichero_generado_at: new Date().toISOString() })
      .eq('id', r)
      .select('id')
      .maybeSingle()
    expect(marca.error).toBeNull()
    expect(marca.data).not.toBeNull()

    const nuevo = await enlazar(cDirectora, r, await recibo())
    expect(nuevo.error?.hint).toBe('remesa_con_fichero')
    const suelta = await cDirectora.from('recibos_remesa').delete().eq('recibo_id', dentro)
    expect(suelta.error?.hint).toBe('remesa_con_fichero')
    const quitada = await serviceClient
      .from('remesas')
      .update({ fichero_generado_at: null })
      .eq('id', r)
    expect(quitada.error?.hint).toBe('fichero_generado')
  })

  it('solo entran recibos por banco, confirmados, con importe y del centro', async () => {
    const r = await remesa()
    const noRemesables = {
      borrador: await recibo({ estado: 'borrador' }),
      efectivo: await recibo({ metodo: 'efectivo' }),
      sinImporte: await recibo({ total_centimos: 0 }),
      enviado: await recibo({ estado: 'enviado_banco', fecha_envio_banco: '2026-03-02' }),
    }
    for (const [caso, id] of Object.entries(noRemesables)) {
      const r1 = await enlazar(cDirectora, r, id)
      expect(r1.error?.hint, caso).toBe('recibo_no_remesable')
    }

    const { data: ajeno } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: otroCentro.id,
        familia_id: familiaOtro,
        anio: ANIO,
        mes: MES,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Remesa única',
      })
      .select('id')
      .single()
    const otro = await enlazar(serviceClient, r, ajeno!.id)
    expect(otro.error?.hint).toBe('recibo_no_remesable')
  })

  it('una remesa enviada no vuelve a borrador ni se borra; con el fichero, tampoco se borra', async () => {
    const enviada = await remesa()
    expect((await enlazar(cDirectora, enviada, await recibo())).error).toBeNull()
    expect(
      (
        await cDirectora
          .from('remesas')
          .update({ estado: 'enviada', fecha_envio_banco: '2026-03-05' })
          .eq('id', enviada)
      ).error
    ).toBeNull()
    const vuelta = await cDirectora
      .from('remesas')
      .update({ estado: 'borrador', fecha_envio_banco: null })
      .eq('id', enviada)
    expect(vuelta.error?.hint).toBe('remesa_cerrada')
    const borrada = await cDirectora
      .from('remesas')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', enviada)
    expect(borrada.error?.hint).toBe('remesa_cerrada')

    const conFichero = await remesa()
    expect(
      (
        await cDirectora
          .from('remesas')
          .update({ fichero_generado_at: new Date().toISOString() })
          .eq('id', conFichero)
      ).error
    ).toBeNull()
    const borradaFichero = await cDirectora
      .from('remesas')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', conFichero)
    expect(borradaFichero.error?.hint).toBe('remesa_con_fichero')
  })

  it('el recibo de una remesa borrada vuelve a entrar en otra', async () => {
    const id = await recibo()
    const borrada = await remesa()
    expect((await enlazar(cDirectora, borrada, id)).error).toBeNull()
    const baja = await cDirectora
      .from('remesas')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', borrada)
      .select('id')
      .maybeSingle()
    expect(baja.error).toBeNull()
    expect(baja.data).not.toBeNull()

    const nueva = await remesa()
    expect((await enlazar(cDirectora, nueva, id)).error).toBeNull()
    expect((await enlaces(id)).sort()).toEqual([borrada, nueva].sort())
  })

  it('un recibo en una remesa viva no vuelve a borrador, tampoco con service_role', async () => {
    const id = await recibo({ es_esporadico: false, concepto_esporadico: null, mes: 4 })
    const r = await remesa()
    expect((await enlazar(cDirectora, r, id)).error).toBeNull()

    const directo = await serviceClient.from('recibos').update({ estado: 'borrador' }).eq('id', id)
    expect(directo.error?.hint).toBe('recibo_en_remesa')
    const rpc = await cDirectora.rpc('desconfirmar_recibo', { p_recibo_id: id })
    expect(rpc.error).not.toBeNull()
    const { data } = await serviceClient.from('recibos').select('estado').eq('id', id).single()
    expect(data?.estado).toBe('pendiente_procesar')
  })

  it('el enlace no cambia de remesa ni de recibo', async () => {
    const id = await recibo()
    const r = await remesa()
    const otra = await remesa()
    expect((await enlazar(cDirectora, r, id)).error).toBeNull()

    const movido = await serviceClient
      .from('recibos_remesa')
      .update({ remesa_id: otra })
      .eq('recibo_id', id)
    expect(movido.error?.hint).toBe('enlace_fijo')
    const cambiado = await serviceClient
      .from('recibos_remesa')
      .update({ recibo_id: await recibo() })
      .eq('recibo_id', id)
    expect(cambiado.error?.hint).toBe('enlace_fijo')
    expect(await enlaces(id)).toEqual([r])
  })
})
