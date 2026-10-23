import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * PR-5 (`20261110120000`) — una beca descontada pasa a «aplicada».
 *
 *  - El motor guarda en la línea de beca qué tramo descuenta (`lineas_recibo.beca_tramo_id`).
 *  - Al validar el recibo, esos tramos (y solo esos) pasan a `aplicada` con su recibo; al volver
 *    a borrador, a `pendiente` (trigger `recibos_aplicar_becas`).
 *  - El estado no se escribe a mano, tampoco con service_role; una beca aplicada no se modifica
 *    ni se borra desde Dirección (trigger `beca_tramo_proteger`).
 *
 * UN MES POR TEST: validar el último borrador de un mes lo cierra.
 */

const ANIO = 2026

describe('PR-5 — beca aplicada al validar', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cuota: string

  async function familiaConNino(): Promise<{ familia: string; nino: string }> {
    const familia = await createTestFamilia(centro.id)
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Nino PR5',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    // Una cuota mayor que la beca: sin desborde, que no dejaría validar (PR-3).
    const asig = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, nino_id: data.id, concepto_id: cuota, origen: 'manual' })
    if (asig.error) throw new Error(`asignar: ${asig.error.message}`)
    return { familia, nino: data.id }
  }

  async function tramo(nino: string, mes: number, mesCorr: number, importe = 3000) {
    const { data, error } = await serviceClient
      .from('beca_comedor_tramo')
      .insert({
        centro_id: centro.id,
        nino_id: nino,
        curso_academico_id: curso.id,
        anio_correspondiente: ANIO,
        mes_correspondiente: mesCorr,
        anio_aplicacion: ANIO,
        mes_aplicacion: mes,
        importe_centimos: importe,
        origen: 'normal',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`tramo: ${error?.message}`)
    return data.id
  }

  async function generar(mes: number) {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: mes,
    })
    expect(error).toBeNull()
  }

  async function recibo(familia: string, mes: number): Promise<string> {
    const { data } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', mes)
      .eq('es_esporadico', false)
      .single()
    if (!data) throw new Error('sin recibo')
    return data.id
  }

  async function estado(tramoId: string) {
    const { data } = await serviceClient
      .from('beca_comedor_tramo')
      .select('estado, aplicada_en_recibo_id')
      .eq('id', tramoId)
      .single()
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Beca Aplicada PR5')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Beca Aplicada PR5' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Cuota PR5',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        importe_centimos: 20000,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`cuota: ${error?.message}`)
    cuota = data.id
  }, 60_000)

  afterAll(async () => {
    // service_role borra también las aplicadas (como el congelado del recibo), y antes que los
    // recibos a los que apuntan.
    await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('premisa: el motor liga la línea de beca a su tramo, que sigue pendiente', async () => {
    const { familia, nino } = await familiaConNino()
    const t = await tramo(nino, 1, 12)
    await generar(1)
    const r = await recibo(familia, 1)
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos')
      .eq('recibo_id', r)
      .eq('beca_tramo_id', t)
    expect(lineas).toEqual([{ importe_centimos: -3000 }])
    expect(await estado(t)).toEqual({ estado: 'pendiente', aplicada_en_recibo_id: null })
  })

  it('al validar, la beca del recibo pasa a aplicada en él; una carga posterior a generar, no', async () => {
    const { familia, nino } = await familiaConNino()
    const t = await tramo(nino, 2, 1)
    await generar(2)
    const r = await recibo(familia, 2)
    // Creada después de generar y sin regenerar: no está en el recibo.
    const tardia = await tramo(nino, 2, 2, 1000)

    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    expect(await estado(t)).toEqual({ estado: 'aplicada', aplicada_en_recibo_id: r })
    expect(await estado(tardia)).toEqual({ estado: 'pendiente', aplicada_en_recibo_id: null })
  })

  it('al volver a borrador, pendiente; validada otra vez, aplicada', async () => {
    const { familia, nino } = await familiaConNino()
    const t = await tramo(nino, 3, 2)
    await generar(3)
    const r = await recibo(familia, 3)
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    expect((await estado(t))?.estado).toBe('aplicada')

    expect((await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    expect(await estado(t)).toEqual({ estado: 'pendiente', aplicada_en_recibo_id: null })

    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    expect(await estado(t)).toEqual({ estado: 'aplicada', aplicada_en_recibo_id: r })
  })

  it('una beca aplicada: Dirección no la modifica ni la borra', async () => {
    const { familia, nino } = await familiaConNino()
    const t = await tramo(nino, 4, 3)
    await generar(4)
    const r = await recibo(familia, 4)
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    expect((await estado(t))?.estado).toBe('aplicada')

    const editar = await cAdmin
      .from('beca_comedor_tramo')
      .update({ importe_centimos: 1 })
      .eq('id', t)
    expect(editar.error?.hint).toBe('beca_aplicada')
    const borrar = await cAdmin.from('beca_comedor_tramo').delete().eq('id', t)
    expect(borrar.error?.hint).toBe('beca_aplicada')
    expect(await estado(t)).toEqual({ estado: 'aplicada', aplicada_en_recibo_id: r })
  })

  it('el estado no se escribe a mano: ni Dirección ni service_role; un tramo nace pendiente', async () => {
    const { familia, nino } = await familiaConNino()
    const t = await tramo(nino, 5, 4)
    await generar(5)
    const r = await recibo(familia, 5)
    for (const cliente of [cAdmin, serviceClient]) {
      const { error } = await cliente
        .from('beca_comedor_tramo')
        .update({ estado: 'aplicada', aplicada_en_recibo_id: r })
        .eq('id', t)
      expect(error?.hint).toBe('beca_estado_por_recibo')
    }
    const nace = await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: nino,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: 5,
      anio_aplicacion: ANIO,
      mes_aplicacion: 5,
      importe_centimos: 100,
      origen: 'normal',
      estado: 'aplicada',
    })
    expect(nace.error?.hint).toBe('beca_estado_por_recibo')
    expect(await estado(t)).toEqual({ estado: 'pendiente', aplicada_en_recibo_id: null })
  })

  it('la misma beca en otro recibo no se valida: ya está descontada', async () => {
    const a = await familiaConNino()
    const b = await familiaConNino()
    const t = await tramo(a.nino, 6, 5)
    await generar(6)
    const ra = await recibo(a.familia, 6)
    const rb = await recibo(b.familia, 6)
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: ra })).error).toBeNull()

    const linea = await serviceClient.from('lineas_recibo').insert({
      recibo_id: rb,
      centro_id: centro.id,
      descripcion: 'Beca duplicada',
      cantidad: 1,
      precio_unitario_centimos: -3000,
      importe_centimos: -3000,
      beca_tramo_id: t,
    })
    expect(linea.error).toBeNull()
    const { error } = await cAdmin.rpc('confirmar_recibo', { p_recibo_id: rb })
    expect(error?.hint).toBe('beca_ya_aplicada')
    expect(await estado(t)).toEqual({ estado: 'aplicada', aplicada_en_recibo_id: ra })
  })
})
