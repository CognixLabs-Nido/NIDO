import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import {
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'
import { prepararRecibo, quienRechaza, type DestinoRecibo } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * La devolución, el cobro a mano, confirmar y desconfirmar (`20261223120000`, decisiones C y D del
 * responsable: para todos, también service_role), contra la BD real.
 *
 *  - C. `marcar_recibo_devuelto` y `marcar_cobrado_manual` son los dueños de esos dos hechos de
 *    dinero: hacen los rechazos que hacía la app, cada uno con su HINT, y por fuera no se entra en
 *    devuelto (`devuelto_por_funcion`) ni en cobrado (`cobrado_por_funcion`). Las otras dos entradas
 *    en cobrado (el cheque y la devolución resuelta) siguen pasando.
 *  - D. De borrador a pendiente solo `confirmar_recibo` (`confirmar_por_funcion`), y la vuelta solo
 *    `desconfirmar_recibo` (`desconfirmar_por_funcion`): por fuera, con el mes cerrado, la vuelta
 *    dejaba el mes cerrado con un borrador dentro. Un recibo nace en borrador
 *    (`recibo_nace_en_borrador`), salvo el esporádico de `crear_recibo_esporadico`.
 */

type Insert = Database['public']['Tables']['recibos']['Insert']

describe('La devolución y el cobro a mano tienen dueño; confirmar y desconfirmar, también', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let directora: TestUser
  let directoraOtro: TestUser
  let tutor: TestUser
  let cDirectora: SupabaseClient<Database>
  let cDirectoraOtro: SupabaseClient<Database>
  /** Admin en el otro centro y tutora de la familia en este: ve el recibo, pero no es su admin. */
  let mixta: TestUser
  let cMixta: SupabaseClient<Database>
  let mesRegular = 0
  const HOY = hoyMadrid()

  /** Un recibo en borrador (esporádico, salvo que se pida otra cosa), llevado a su estado. */
  async function recibo(
    destino: DestinoRecibo | null = null,
    over: Partial<Insert> = {}
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 3,
        estado: 'borrador',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Devuelto y cobrado',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    if (destino) prepararRecibo(data.id, destino)
    return data.id
  }

  function regular(destino: DestinoRecibo | null = null, over: Partial<Insert> = {}) {
    mesRegular += 1
    return recibo(destino, {
      es_esporadico: false,
      concepto_esporadico: null,
      mes: mesRegular,
      ...over,
    })
  }

  const ENVIADO: DestinoRecibo = { estado: 'enviado_banco', fecha_envio_banco: '2026-03-05' }
  const PENDIENTE: DestinoRecibo = { estado: 'pendiente_procesar' }

  async function fila(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select(
        'estado, fecha_envio_banco, fecha_devolucion, devolucion_gastos_centimos, cobro_forma, cobro_fecha, cobro_nota'
      )
      .eq('id', id)
      .single()
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Devuelto y cobrado')
    otroCentro = await createTestCentro('Otro devuelto y cobrado')
    familia = await createTestFamilia(centro.id)
    directora = await createTestUser({ nombre: 'Directora Devuelto' })
    directoraOtro = await createTestUser({ nombre: 'Directora Otra Devuelto' })
    tutor = await createTestUser({ nombre: 'Tutora Devuelto' })
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cDirectora = await clientFor(directora)
    cDirectoraOtro = await clientFor(directoraOtro)
    mixta = await createTestUser({ nombre: 'Admin Otro y Tutora Devuelto' })
    await asignarRol(mixta.id, otroCentro.id, 'admin')
    await asignarRol(mixta.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, mixta.id, 'segundo_tutor')
    cMixta = await clientFor(mixta)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestUser(directoraOtro.id)
    await deleteTestUser(tutor.id)
    await deleteTestUser(mixta.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
  }, 60_000)

  // ---- C · el centro del registro, ahora en la base ----

  it('ser admin en otro centro no basta: la tutora de la familia que es admin en otro no devuelve ni cobra', async () => {
    // Hasta 20261223120000 lo miraba la acción (usuarioAdminEn del centro del recibo). Ahora la
    // función: la fila se bloquea por la política de UPDATE (es_admin del centro del recibo), y sin
    // ella no la encuentra; detrás, su es_admin.
    const enviado = await recibo(ENVIADO)
    const pendiente = await recibo(PENDIENTE, { metodo: 'efectivo' })
    // Premisa: lo VE (es tutora de la familia), así que lo que se mide no es que no lo vea.
    const visto = await cMixta.from('recibos').select('id').in('id', [enviado, pendiente])
    expect((visto.data ?? []).map((r) => r.id).sort()).toEqual([enviado, pendiente].sort())

    const dev = await cMixta.rpc('marcar_recibo_devuelto', {
      p_recibo_id: enviado,
      p_fecha: '2026-03-20',
      p_gastos_centimos: 0,
    })
    expect(dev.error?.code).toBe('P0002')
    expect(dev.error?.hint).toBe('no_encontrado')
    const cob = await cMixta.rpc('marcar_cobrado_manual', {
      p_recibo_id: pendiente,
      p_forma: 'efectivo',
      p_fecha: '2026-03-20',
      p_nota: '',
    })
    expect(cob.error?.code).toBe('P0002')
    expect(cob.error?.hint).toBe('no_encontrado')
    expect((await fila(enviado))?.estado).toBe('enviado_banco')
    expect((await fila(pendiente))?.estado).toBe('pendiente_procesar')
  })

  // ---- C · la devolución ----

  it('marcar_recibo_devuelto: el enviado pasa a devuelto con la fecha del banco y sus gastos', async () => {
    const id = await recibo(ENVIADO)
    expect((await fila(id))?.estado).toBe('enviado_banco')
    const r = await cDirectora.rpc('marcar_recibo_devuelto', {
      p_recibo_id: id,
      p_fecha: '2026-03-20',
      p_gastos_centimos: 350,
    })
    expect(r.error).toBeNull()
    expect(await fila(id)).toMatchObject({
      estado: 'devuelto',
      fecha_envio_banco: '2026-03-05',
      fecha_devolucion: '2026-03-20',
      devolucion_gastos_centimos: 350,
    })
  })

  it('marcar_recibo_devuelto: cada rechazo de la app, con su HINT, y el recibo intacto', async () => {
    const enviado = await recibo(ENVIADO)
    const pendiente = await recibo(PENDIENTE)
    const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    for (const [id, fecha, gastos, hint] of [
      [enviado, manana, 0, 'fecha_devolucion_invalida'],
      [enviado, '2026-03-01', 0, 'devolucion_antes_del_envio'],
      [enviado, '2026-03-20', -1, 'gastos_invalidos'],
      [pendiente, '2026-03-20', 0, 'no_devolvible'],
      ['00000000-0000-4000-8000-000000000000', '2026-03-20', 0, 'no_encontrado'],
    ] as const) {
      const r = await cDirectora.rpc('marcar_recibo_devuelto', {
        p_recibo_id: id,
        p_fecha: fecha,
        p_gastos_centimos: gastos,
      })
      // soft: cada rechazo se mide aunque falle otro (si no, una mutación solo dice el primero).
      expect.soft(r.error?.hint, hint).toBe(hint)
    }
    // La directora de otro centro no ve el recibo: para ella no existe.
    const fuera = await cDirectoraOtro.rpc('marcar_recibo_devuelto', {
      p_recibo_id: enviado,
      p_fecha: '2026-03-20',
      p_gastos_centimos: 0,
    })
    expect(fuera.error?.code).toBe('P0002')
    expect(fuera.error?.hint).toBe('no_encontrado')
    expect((await fila(enviado))?.estado).toBe('enviado_banco')
  })

  it('C · por fuera no se entra en devuelto: ni la sesión, ni service_role, ni por INSERT', async () => {
    const enviado = await recibo(ENVIADO)
    const pendiente = await recibo(PENDIENTE)
    const dev = {
      estado: 'devuelto' as const,
      fecha_devolucion: '2026-03-20',
      devolucion_gastos_centimos: 0,
    }
    for (const c of [cDirectora, serviceClient]) {
      const { error } = await c.from('recibos').update(dev).eq('id', enviado)
      expect(error?.hint).toBe('devuelto_por_funcion')
    }
    const sinBanco = await cDirectora
      .from('recibos')
      .update({ ...dev, fecha_envio_banco: '2026-03-05' })
      .eq('id', pendiente)
    expect(sinBanco.error?.hint).toBe('devuelto_por_funcion')
    const nace = await serviceClient.from('recibos').insert({
      centro_id: centro.id,
      familia_id: familia,
      anio: 2026,
      mes: 3,
      metodo: 'sepa',
      total_centimos: 100,
      es_esporadico: true,
      concepto_esporadico: 'Nace devuelto',
      fecha_envio_banco: '2026-03-05',
      ...dev,
    })
    expect(nace.error?.hint).toBe('recibo_nace_en_borrador')
    expect((await fila(enviado))?.estado).toBe('enviado_banco')
  })

  // ---- C · el cobro a mano ----

  it('marcar_cobrado_manual: un pendiente en efectivo queda cobrado, con la nota sin espacios', async () => {
    const id = await recibo(PENDIENTE, { metodo: 'efectivo' })
    const r = await cDirectora.rpc('marcar_cobrado_manual', {
      p_recibo_id: id,
      p_forma: 'transferencia',
      p_fecha: HOY,
      p_nota: '  pagó en secretaría  ',
    })
    expect(r.error).toBeNull()
    expect(await fila(id)).toMatchObject({
      estado: 'cobrado_manual',
      cobro_forma: 'transferencia',
      cobro_fecha: HOY,
      cobro_nota: 'pagó en secretaría',
    })
    const sinNota = await recibo(PENDIENTE, { metodo: 'efectivo' })
    await cDirectora.rpc('marcar_cobrado_manual', {
      p_recibo_id: sinNota,
      p_forma: 'efectivo',
      p_fecha: HOY,
      p_nota: '',
    })
    expect((await fila(sinNota))?.cobro_nota).toBeNull()
  })

  it('los dos rechazos que repite el trigger de detrás los da la función ella misma', async () => {
    // La fecha futura de la devolución y el SEPA pendiente: la función y el trigger de detrás
    // (`recibos_validar_devolucion`, `recibos_validar_cobro_manual`) dicen lo mismo, con el mismo
    // código, HINT y mensaje, así que por la app no se distinguen y quitar el de la función no
    // pondría nada en rojo. Lo que los separa es quién lanza el RAISE (el contexto del error, que
    // PostgREST no devuelve). Medido en el ensayo: sin el rechazo de la función, el origen pasa a
    // ser el trigger, con el mismo código y HINT.
    const enviado = await recibo(ENVIADO)
    const sepa = await recibo(PENDIENTE)
    const futura = quienRechaza(
      directora.id,
      `SELECT public.marcar_recibo_devuelto('${enviado}', public.hoy_madrid() + 3, 0)`
    )
    expect(futura).toMatchObject({ code: '22023', hint: 'fecha_devolucion_invalida' })
    expect(futura?.origen).toMatch(/^PL\/pgSQL function marcar_recibo_devuelto\(.* at RAISE$/)
    const porRemesa = quienRechaza(
      directora.id,
      `SELECT public.marcar_cobrado_manual('${sepa}', 'efectivo', public.hoy_madrid(), '')`
    )
    expect(porRemesa).toMatchObject({ code: 'P0001', hint: 'sepa_por_remesa' })
    expect(porRemesa?.origen).toMatch(/^PL\/pgSQL function marcar_cobrado_manual\(.* at RAISE$/)
    // Y el instrumento ve también el otro origen: por fuera, el SEPA pendiente lo rechaza el
    // trigger nuevo, no la función.
    const directo = quienRechaza(
      directora.id,
      `UPDATE public.recibos SET estado = 'cobrado_manual', cobro_forma = 'efectivo', cobro_fecha = public.hoy_madrid() WHERE id = '${sepa}'`
    )
    expect(directo?.origen).toMatch(/^PL\/pgSQL function recibos_dinero_solo_por_funcion\(\)/)
    expect((await fila(enviado))?.estado).toBe('enviado_banco')
    expect((await fila(sepa))?.estado).toBe('pendiente_procesar')
  })

  it('marcar_cobrado_manual: cada rechazo de la app, con su HINT, y el recibo intacto', async () => {
    const efectivo = await recibo(PENDIENTE, { metodo: 'efectivo' })
    const sepa = await recibo(PENDIENTE)
    const enviado = await recibo(ENVIADO)
    const devuelto = await recibo({
      estado: 'devuelto',
      fecha_envio_banco: '2026-03-05',
      fecha_devolucion: '2026-03-20',
    })
    const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    for (const [id, forma, fecha, nota, hint] of [
      [sepa, 'efectivo', HOY, '', 'sepa_por_remesa'],
      [devuelto, 'efectivo', HOY, '', 'devolucion_por_resolver'],
      [enviado, 'efectivo', HOY, '', 'no_cobrable_manual'],
      [efectivo, 'cheque_guarderia', HOY, '', 'forma_no_valida'],
      [efectivo, 'efectivo', manana, '', 'fecha_cobro_futura'],
      [efectivo, 'efectivo', null as unknown as string, '', 'datos_no_validos'],
      [efectivo, 'efectivo', HOY, 'x'.repeat(501), 'nota_cobro_larga'],
      ['00000000-0000-4000-8000-000000000000', 'efectivo', HOY, '', 'no_encontrado'],
    ] as const) {
      const r = await cDirectora.rpc('marcar_cobrado_manual', {
        p_recibo_id: id,
        p_forma: forma,
        p_fecha: fecha,
        p_nota: nota,
      })
      // soft: cada rechazo se mide aunque falle otro (si no, una mutación solo dice el primero).
      expect.soft(r.error?.hint, hint).toBe(hint)
    }
    expect((await fila(efectivo))?.estado).toBe('pendiente_procesar')
    expect((await fila(devuelto))?.estado).toBe('devuelto')
  })

  it('C · por fuera no se cobra a mano: ni la sesión, ni service_role, ni por INSERT', async () => {
    const id = await recibo(PENDIENTE, { metodo: 'efectivo' })
    const cobro = {
      estado: 'cobrado_manual' as const,
      cobro_forma: 'efectivo' as const,
      cobro_fecha: HOY,
    }
    for (const c of [cDirectora, serviceClient]) {
      const { error } = await c.from('recibos').update(cobro).eq('id', id)
      expect(error?.hint).toBe('cobrado_por_funcion')
    }
    const nace = await cDirectora.from('recibos').insert({
      centro_id: centro.id,
      familia_id: familia,
      anio: 2026,
      mes: 3,
      metodo: 'efectivo',
      total_centimos: 100,
      es_esporadico: true,
      concepto_esporadico: 'Nace cobrado',
      ...cobro,
    })
    expect(nace.error?.hint).toBe('recibo_nace_en_borrador')
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
  })

  it('C · las otras entradas en cobrado siguen: el cheque y la devolución resuelta', async () => {
    const conCheque = await recibo(PENDIENTE, { metodo: 'cheque_guarderia' })
    const cheque = await cDirectora.rpc('cobrar_recibo_con_cheque', {
      p_recibo_id: conCheque,
      p_importe_centimos: 10000,
      p_fecha: HOY,
      p_nota: '',
      p_metodo_diferencia: '',
    })
    expect(cheque.error).toBeNull()
    expect((await fila(conCheque))?.estado).toBe('cobrado_manual')

    const devuelto = await recibo({
      estado: 'devuelto',
      fecha_envio_banco: '2026-03-05',
      fecha_devolucion: '2026-03-20',
    })
    const resuelta = await cDirectora.rpc('resolver_devolucion', {
      p_recibo_id: devuelto,
      p_salida: 'efectivo',
      p_fecha: HOY,
      p_nota: '',
    })
    expect(resuelta.error).toBeNull()
    expect((await fila(devuelto))?.estado).toBe('cobrado_manual')
  })

  // ---- D · confirmar, desconfirmar y nacer en pendiente ----

  it('D · de borrador a pendiente solo confirmar_recibo, también para service_role', async () => {
    const id = await regular()
    for (const c of [cDirectora, serviceClient]) {
      const { error } = await c
        .from('recibos')
        .update({ estado: 'pendiente_procesar' })
        .eq('id', id)
      expect(error?.hint).toBe('confirmar_por_funcion')
    }
    expect((await fila(id))?.estado).toBe('borrador')
    expect((await cDirectora.rpc('confirmar_recibo', { p_recibo_id: id })).error).toBeNull()
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
  })

  it('D · con el mes cerrado, la vuelta a borrador por fuera no pasa y el cierre sigue; desconfirmar lo quita', async () => {
    const id = await regular()
    const { data: mes } = await serviceClient.from('recibos').select('mes').eq('id', id).single()
    // Confirmar el único regular del mes cierra el mes (el ancla de cierre_mensual).
    expect((await cDirectora.rpc('confirmar_recibo', { p_recibo_id: id })).data).toBe(true)
    const cierre = async () =>
      (
        await serviceClient
          .from('cierre_mensual')
          .select('id')
          .eq('centro_id', centro.id)
          .eq('anio', 2026)
          .eq('mes', mes!.mes)
      ).data?.length
    expect(await cierre()).toBe(1)
    for (const c of [cDirectora, serviceClient]) {
      const { error } = await c.from('recibos').update({ estado: 'borrador' }).eq('id', id)
      expect(error?.hint).toBe('desconfirmar_por_funcion')
    }
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
    expect(await cierre()).toBe(1)
    expect((await cDirectora.rpc('desconfirmar_recibo', { p_recibo_id: id })).error).toBeNull()
    expect((await fila(id))?.estado).toBe('borrador')
    expect(await cierre()).toBe(0)
  })

  it('D · un recibo nace en borrador; en pendiente, solo el esporádico de su función', async () => {
    mesRegular += 1
    for (const [c, esporadico] of [
      [cDirectora, false],
      [serviceClient, false],
      [cDirectora, true],
    ] as const) {
      const { error } = await c.from('recibos').insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: mesRegular,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 100,
        es_esporadico: esporadico,
        concepto_esporadico: esporadico ? 'Nace pendiente' : null,
      })
      expect(error?.hint).toBe('recibo_nace_en_borrador')
    }
    const r = await cDirectora.rpc('crear_recibo_esporadico', {
      p_centro_id: centro.id,
      p_familia_id: familia,
      p_nino_id: null as never,
      p_anio: 2026,
      p_mes: 3,
      p_concepto: 'Excursión',
      p_metodo: 'efectivo',
      p_lineas: [{ descripcion: 'Excursión', cantidad: 1, precio_unitario_centimos: 700 }] as never,
    })
    expect(r.error).toBeNull()
    expect(await fila(r.data as string)).toMatchObject({ estado: 'pendiente_procesar' })
  })
})
