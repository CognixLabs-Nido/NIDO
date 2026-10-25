import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-1c (`20261119120000`) — el sobrante cuando el cheque supera el recibo, contra la BD real.
 *
 *  - Cobrar con un cheque mayor deja el recibo cobrado y el sobrante PENDIENTE: una fila de
 *    `beca_comedor_desborde` con `origen = 'cheque'`. Un recibo sin importe no se cobra con cheque.
 *  - Se resuelve una vez (`resolver_sobrante_cheque`): diferir es una línea de saldo a favor en el
 *    recibo del mes siguiente (se crea si no lo hay; validado o con el mes cerrado, no), solo con
 *    hijos activos; transferencia, una fila pendiente de `beca_comedor_transferencia` con su origen.
 *  - El sobrante, su transferencia y su línea solo los escriben las funciones; no se borran (salvo
 *    la línea, que deja el sobrante pendiente). El motor respeta la línea.
 *  - El desborde de beca y el sobrante del cheque de un mismo recibo no chocan.
 *  - El export del art. 15 dice el origen.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const FECHA = '2026-01-20'

describe('PR-1c — el sobrante de un cheque mayor que el recibo', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let familiaSinHijos: string
  let familiaValidado: string
  let familiaCerrado: string
  let directora: TestUser
  let directoraOtro: TestUser
  let tutora: TestUser
  let cDirectora: SupabaseClient<Database>
  let reciboCheque: string
  let febrero: string

  async function recibo(familiaId: string, over: Partial<Recibo> = {}): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        anio: 2026,
        mes: 1,
        estado: 'pendiente_procesar',
        metodo: 'cheque_guarderia',
        total_centimos: 11000,
        es_esporadico: false,
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  function cheque(cliente: SupabaseClient<Database>, id: string, importe: number) {
    return cliente.rpc('cobrar_recibo_con_cheque', {
      p_recibo_id: id,
      p_importe_centimos: importe,
      p_fecha: FECHA,
      p_nota: null as unknown as string,
      p_metodo_diferencia: null as unknown as string,
    })
  }

  function resolver(cliente: SupabaseClient<Database>, id: string, via: string) {
    return cliente.rpc('resolver_sobrante_cheque', { p_recibo_id: id, p_via: via })
  }

  async function sobrante(reciboId: string) {
    const { data } = await serviceClient
      .from('beca_comedor_desborde')
      .select('*')
      .eq('recibo_id', reciboId)
      .eq('origen', 'cheque')
      .maybeSingle()
    return data
  }

  async function estado(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select('familia_id, anio, mes, estado, total_centimos, cobro_forma, cobro_importe_centimos')
      .eq('id', id)
      .single()
    return data
  }

  async function lineas(reciboId: string) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select(
        'id, nino_id, descripcion, cantidad, importe_centimos, origen, sobrante_de_desborde_id'
      )
      .eq('recibo_id', reciboId)
      .order('created_at')
    return data ?? []
  }

  async function regulares(familiaId: string, mes: number) {
    const { data } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('familia_id', familiaId)
      .eq('anio', 2026)
      .eq('mes', mes)
      .eq('es_esporadico', false)
      .is('devuelto_de_recibo_id', null)
      .is('deleted_at', null)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cheque Sobrante PR1c')
    otroCentro = await createTestCentro('Otro Centro Cheque PR1c')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)

    const nino = await createTestNino(centro.id, 'Nino Cheque Sobrante PR1c')
    familia = nino.familia_id
    await matricular(nino.id, aula.id, curso.id)
    familiaSinHijos = (await createTestNino(centro.id, 'Nino Sin Matricula PR1c')).familia_id
    const ninoValidado = await createTestNino(centro.id, 'Nino Febrero Validado PR1c')
    familiaValidado = ninoValidado.familia_id
    await matricular(ninoValidado.id, aula.id, curso.id)
    const ninoCerrado = await createTestNino(centro.id, 'Nino Mes Cerrado PR1c')
    familiaCerrado = ninoCerrado.familia_id
    await matricular(ninoCerrado.id, aula.id, curso.id)

    directora = await createTestUser({ nombre: 'Directora Cheque PR1c' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
    directoraOtro = await createTestUser({ nombre: 'Directora Otro Centro Cheque PR1c' })
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    tutora = await createTestUser({ nombre: 'Tutora Cheque PR1c' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutora.id)

    reciboCheque = await recibo(familia)
  }, 120_000)

  afterAll(async () => {
    for (const c of [centro, otroCentro]) {
      // La línea primero (apunta al sobrante), después las transferencias, los sobrantes y los
      // recibos. Con service_role, que es el único que borra un sobrante.
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [directora, directoraOtro, tutora]) await deleteTestUser(u.id)
  }, 120_000)

  it('un cheque mayor deja el recibo cobrado y el sobrante pendiente, sin recibo de diferencia', async () => {
    const { data, error } = await cheque(cDirectora, reciboCheque, 12000)
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await estado(reciboCheque)).toMatchObject({
      estado: 'cobrado_manual',
      cobro_forma: 'cheque_guarderia',
      cobro_importe_centimos: 12000,
      total_centimos: 11000,
    })
    expect(await sobrante(reciboCheque)).toMatchObject({
      familia_id: familia,
      anio: 2026,
      mes: 1,
      cuota_total_centimos: 11000,
      beca_total_centimos: 12000,
      exceso_centimos: 1000,
      estado: 'pendiente',
      via: null,
    })
    const { data: diferencias } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('diferencia_de_recibo_id', reciboCheque)
    expect(diferencias).toEqual([])
  })

  it('un recibo sin importe no se cobra con cheque, y no escribe nada', async () => {
    const cero = await recibo(familiaSinHijos, { mes: 5, total_centimos: 0 })
    const { error } = await cheque(cDirectora, cero, 1000)
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('recibo_sin_importe')
    expect(await estado(cero)).toMatchObject({ estado: 'pendiente_procesar', cobro_forma: null })
    expect(await sobrante(cero)).toBeNull()
  })

  it('el sobrante no se escribe ni se borra a mano, tampoco con service_role', async () => {
    const otro = await recibo(familiaSinHijos, { mes: 6 })
    for (const cliente of [cDirectora, serviceClient]) {
      const { error } = await cliente.from('beca_comedor_desborde').insert({
        centro_id: centro.id,
        recibo_id: otro,
        familia_id: familiaSinHijos,
        anio: 2026,
        mes: 6,
        cuota_total_centimos: 11000,
        beca_total_centimos: 12000,
        exceso_centimos: 1000,
        origen: 'cheque',
      })
      expect(error?.hint).toBe('sobrante_por_funcion')
    }
    const id = (await sobrante(reciboCheque))!.id
    const resuelto = await cDirectora
      .from('beca_comedor_desborde')
      .update({ estado: 'resuelto', via: 'transferencia', resuelto_at: new Date().toISOString() })
      .eq('id', id)
    expect(resuelto.error?.hint).toBe('sobrante_por_funcion')
    const borrado = await cDirectora.from('beca_comedor_desborde').delete().eq('id', id)
    expect(borrado.error?.hint).toBe('sobrante_no_se_borra')
    expect(await sobrante(reciboCheque)).toMatchObject({ estado: 'pendiente' })
  })

  it('fuera: el tutor y la Dirección de otro centro no lo resuelven', async () => {
    for (const u of [tutora, directoraOtro]) {
      const r = await resolver(await clientFor(u), reciboCheque, 'diferir')
      expect(r.error, u.id).not.toBeNull()
    }
    expect(await sobrante(reciboCheque)).toMatchObject({ estado: 'pendiente' })
  })

  it('diferir: una línea de saldo a favor en el recibo del mes siguiente, que se crea', async () => {
    expect(await regulares(familia, 2)).toHaveLength(0)
    const { data, error } = await resolver(cDirectora, reciboCheque, 'diferir')
    expect(error).toBeNull()
    febrero = data as string
    expect(await estado(febrero)).toMatchObject({
      familia_id: familia,
      anio: 2026,
      mes: 2,
      estado: 'borrador',
      total_centimos: -1000,
    })
    const deFebrero = await lineas(febrero)
    expect(deFebrero).toHaveLength(1)
    expect(deFebrero[0]).toMatchObject({
      nino_id: null,
      descripcion: 'Saldo a favor del cheque guardería / Ticket restaurant de enero de 2026',
      cantidad: 1,
      importe_centimos: -1000,
      origen: 'manual',
      sobrante_de_desborde_id: (await sobrante(reciboCheque))!.id,
    })
    expect(await sobrante(reciboCheque)).toMatchObject({
      estado: 'resuelto',
      via: 'reducir',
      resuelto_por: directora.id,
    })
  })

  it('una segunda resolución se rechaza', async () => {
    for (const via of ['diferir', 'transferencia']) {
      const r = await resolver(cDirectora, reciboCheque, via)
      expect(r.error?.hint, via).toBe('ya_resuelto')
    }
  })

  it('la línea no se edita ni se crea a mano, tampoco con service_role', async () => {
    const linea = (await lineas(febrero))[0]!
    for (const cliente of [cDirectora, serviceClient]) {
      const editada = await cliente
        .from('lineas_recibo')
        .update({ importe_centimos: -1, precio_unitario_centimos: -1 })
        .eq('id', linea.id)
      expect(editada.error?.hint).toBe('linea_sobrante')
      const nueva = await cliente.from('lineas_recibo').insert({
        centro_id: centro.id,
        recibo_id: febrero,
        descripcion: 'Saldo a mano PR1c',
        cantidad: 1,
        precio_unitario_centimos: -1000,
        importe_centimos: -1000,
        origen: 'manual',
        sobrante_de_desborde_id: linea.sobrante_de_desborde_id,
      })
      expect(nueva.error?.hint).toBe('sobrante_por_funcion')
    }
    expect((await lineas(febrero))[0]?.importe_centimos).toBe(-1000)
  })

  it('el motor respeta la línea al generar el mes siguiente', async () => {
    const { error } = await cDirectora.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: 2026,
      p_mes: 2,
    })
    expect(error).toBeNull()
    expect(await regulares(familia, 2)).toEqual([{ id: febrero }])
    const deFebrero = await lineas(febrero)
    expect(deFebrero.filter((l) => l.sobrante_de_desborde_id)).toHaveLength(1)
    const suma = deFebrero.reduce((a, l) => a + l.importe_centimos, 0)
    expect((await estado(febrero))?.total_centimos).toBe(suma)
  })

  it('quitar la línea deja el sobrante pendiente; después se devuelve por transferencia', async () => {
    const linea = (await lineas(febrero)).find((l) => l.sobrante_de_desborde_id)!
    const { error } = await cDirectora.from('lineas_recibo').delete().eq('id', linea.id)
    expect(error).toBeNull()
    expect(await sobrante(reciboCheque)).toMatchObject({
      estado: 'pendiente',
      via: null,
      resuelto_por: null,
      resuelto_at: null,
    })

    const { data, error: errTransf } = await resolver(cDirectora, reciboCheque, 'transferencia')
    expect(errTransf).toBeNull()
    const { data: transferencia } = await serviceClient
      .from('beca_comedor_transferencia')
      .select('*')
      .eq('id', data as string)
      .single()
    expect(transferencia).toMatchObject({
      recibo_id: reciboCheque,
      familia_id: familia,
      anio: 2026,
      mes: 1,
      importe_centimos: 1000,
      estado: 'pendiente',
      origen: 'cheque',
    })
    expect(await sobrante(reciboCheque)).toMatchObject({ estado: 'resuelto', via: 'transferencia' })
  })

  it('su transferencia no se borra ni cambia de importe, pero se marca realizada', async () => {
    const { data: tr } = await serviceClient
      .from('beca_comedor_transferencia')
      .select('id')
      .eq('recibo_id', reciboCheque)
      .eq('origen', 'cheque')
      .single()
    const cambiada = await cDirectora
      .from('beca_comedor_transferencia')
      .update({ importe_centimos: 1 })
      .eq('id', tr!.id)
    expect(cambiada.error?.hint).toBe('sobrante_por_funcion')
    const borrada = await cDirectora.from('beca_comedor_transferencia').delete().eq('id', tr!.id)
    expect(borrada.error?.hint).toBe('sobrante_no_se_borra')
    const realizada = await cDirectora
      .from('beca_comedor_transferencia')
      .update({
        estado: 'realizada',
        realizada_por: directora.id,
        realizada_at: new Date().toISOString(),
      })
      .eq('id', tr!.id)
      .select('estado')
      .single()
    expect(realizada.error).toBeNull()
    expect(realizada.data?.estado).toBe('realizada')
  })

  it('sin hijos activos no se difiere: va por transferencia', async () => {
    const id = await recibo(familiaSinHijos, { mes: 7 })
    expect((await cheque(cDirectora, id, 11500)).error).toBeNull()
    const r = await resolver(cDirectora, id, 'diferir')
    expect(r.error?.hint).toBe('sin_hijos')
    expect(await regulares(familiaSinHijos, 8)).toHaveLength(0)
    expect(await sobrante(id)).toMatchObject({ estado: 'pendiente' })
    expect((await resolver(cDirectora, id, 'transferencia')).error).toBeNull()
  })

  it('con el recibo del mes siguiente validado, o el mes cerrado sin recibo, no se difiere', async () => {
    const enero = await recibo(familiaValidado)
    await recibo(familiaValidado, { mes: 2, metodo: 'sepa', total_centimos: 50000 })
    expect((await cheque(cDirectora, enero, 11200)).error).toBeNull()
    const validado = await resolver(cDirectora, enero, 'diferir')
    expect(validado.error?.hint).toBe('recibo_siguiente_cerrado')
    expect(await regulares(familiaValidado, 2)).toHaveLength(1)

    const marzo = await recibo(familiaCerrado, { mes: 3 })
    expect((await cheque(cDirectora, marzo, 11300)).error).toBeNull()
    await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centro.id, anio: 2026, mes: 4, cerrado_por: directora.id })
    const cerrado = await resolver(cDirectora, marzo, 'diferir')
    expect(cerrado.error?.hint).toBe('mes_siguiente_cerrado')
    expect(await regulares(familiaCerrado, 4)).toHaveLength(0)
    expect(await sobrante(marzo)).toMatchObject({ estado: 'pendiente' })
  })

  it('el desborde de beca y el sobrante del cheque de un mismo recibo no chocan', async () => {
    const { error } = await serviceClient.from('beca_comedor_desborde').insert({
      centro_id: centro.id,
      recibo_id: reciboCheque,
      familia_id: familia,
      anio: 2026,
      mes: 1,
      cuota_total_centimos: 0,
      beca_total_centimos: 500,
      exceso_centimos: 500,
    })
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('beca_comedor_desborde')
      .select('origen')
      .eq('recibo_id', reciboCheque)
      .order('origen')
    expect(data).toEqual([{ origen: 'beca' }, { origen: 'cheque' }])
  })

  it('el export del art. 15 dice el origen del exceso y de la transferencia', async () => {
    const { data, error } = await (
      await clientFor(tutora)
    ).rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutora.id,
    })
    expect(error).toBeNull()
    const cobros = (data as { cobros_familia: Array<Record<string, unknown>> }).cobros_familia
    expect(cobros).toHaveLength(1)
    const excesos = cobros[0]!.beca_comedor_excesos as Array<Record<string, unknown>>
    const transferencias = cobros[0]!.beca_comedor_transferencias as Array<Record<string, unknown>>
    expect(excesos.map((e) => e.origen).sort()).toEqual(['beca', 'cheque'])
    expect(transferencias).toEqual([
      expect.objectContaining({ origen: 'cheque', importe_centimos: 1000 }),
    ])
  })
})
