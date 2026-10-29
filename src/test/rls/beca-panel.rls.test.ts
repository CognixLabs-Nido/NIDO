import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { leerPanelBecas } from '@/features/beca-comedor/lib/leer-panel-becas'
import { aplicado, queda, type PanelBecas } from '@/features/beca-comedor/lib/panel-becas'
import { mesKey } from '@/features/beca-comedor/lib/meses'

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
import { cursoDeTest } from './curso-de-test'

/**
 * PR-11 — el panel de becas, contra la BD real y con la sesión de Dirección: la MISMA lectura
 * que la página (`leerPanelBecas`) sobre lo que escriben el motor, la validación (PR-5) y la
 * resolución del desborde.
 *  - cada beca sale por aplicar, en el recibo sin validar o descontada, según su recibo;
 *  - lo que no cabe en el recibo (desborde) no se cuenta dos veces: lo diferido vuelve como
 *    tramo resto y lo devuelto por transferencia cuenta como aplicado;
 *  - la Dirección de otro centro no ve nada (control positivo delante).
 *
 * UN MES POR TEST: validar el último borrador de un mes lo cierra.
 */

// Los meses del panel son los del curso de `createTestCurso`: el año en que empieza.
const CURSO = cursoDeTest()
const ANIO = Number(CURSO.inicio.slice(0, 4))

describe('PR-11 — panel de becas', () => {
  let centro: { id: string }
  let curso: { id: string; fecha_inicio: string; fecha_fin: string }
  let aula: { id: string }
  let admin: TestUser
  let ajena: TestUser
  let otro: { id: string }
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cuotaAlta: string
  let cuotaBaja: string

  async function concepto(nombre: string, importe: number): Promise<string> {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        importe_centimos: importe,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    return data.id
  }

  async function nino(familia: string, nombre: string, cuota: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre,
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    const asig = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, nino_id: data.id, concepto_id: cuota, origen: 'manual' })
    if (asig.error) throw new Error(`asignar: ${asig.error.message}`)
    // Becado, como `toggleElegibilidad` (sesión de Dirección).
    const elig = await cAdmin.from('beca_comedor_elegibilidad').insert({
      centro_id: centro.id,
      nino_id: data.id,
      curso_academico_id: curso.id,
      activa: true,
    })
    expect(elig.error).toBeNull()
    return data.id
  }

  /** Un tramo de una carga, como lo inserta `escribirPlan` (o «Diferir», con `origen: 'resto'`). */
  async function tramo(
    ninoId: string,
    mesCorr: number,
    mesAplic: number,
    importe: number,
    origen: 'normal' | 'resto' = 'normal'
  ) {
    const { error } = await cAdmin.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: ninoId,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: mesCorr,
      anio_aplicacion: ANIO,
      mes_aplicacion: mesAplic,
      importe_centimos: importe,
      origen,
      estado: 'pendiente',
    })
    expect(error).toBeNull()
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

  async function validar(familia: string, mes: number) {
    const r = await recibo(familia, mes)
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
  }

  /** El claim de `resolverDesborde`: pendiente → resuelto, con la vía. */
  async function resolver(familia: string, mes: number, via: 'reducir' | 'transferencia') {
    const r = await recibo(familia, mes)
    const { data, error } = await cAdmin
      .from('beca_comedor_desborde')
      .update({
        estado: 'resuelto',
        via,
        resuelto_por: admin.id,
        resuelto_at: new Date().toISOString(),
      })
      .eq('recibo_id', r)
      .eq('estado', 'pendiente')
      .select('exceso_centimos')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    return data!.exceso_centimos
  }

  function leer(c = cAdmin): Promise<PanelBecas> {
    return leerPanelBecas(c, centro.id, curso)
  }

  function fila(p: PanelBecas, ninoId: string) {
    const f = p.filas.find((x) => x.id === ninoId)
    if (!f) throw new Error('el alumno no sale en el panel')
    return f
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Panel Becas PR11')
    const c = await createTestCurso(centro.id)
    // Las fechas con las que lo crea `createTestCurso`.
    curso = { id: c.id, fecha_inicio: CURSO.inicio, fecha_fin: CURSO.fin }
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Panel Becas PR11' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    otro = await createTestCentro('Otro Centro Panel Becas PR11')
    ajena = await createTestUser({ nombre: 'Admin Ajena Panel Becas PR11' })
    await asignarRol(ajena.id, otro.id, 'admin')
    cuotaAlta = await concepto('Cuota alta PR11', 20000)
    // Cuota menor que la beca de algunos tests: provoca el desborde.
    cuotaBaja = await concepto('Cuota baja PR11', 3000)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_elegibilidad').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(ajena.id)
  }, 60_000)

  it('cada beca sale por aplicar, en el recibo sin validar y descontada, según su recibo', async () => {
    const familia = await createTestFamilia(centro.id)
    const a = await nino(familia, 'Nino Panel Estados', cuotaAlta)
    await tramo(a, 9, 1, 5000)
    await tramo(a, 10, 2, 4000)

    let f = fila(await leer(), a)
    expect(f.becado).toBe(true) // premisa: lo ve con la sesión de Dirección
    expect(f.matriculado).toBe(true)
    expect(f.meses[mesKey(ANIO, 9)]?.estado).toBe('por_aplicar')

    await generar(1)
    f = fila(await leer(), a)
    expect(f.meses[mesKey(ANIO, 9)]?.estado).toBe('en_recibo')
    expect(f.meses[mesKey(ANIO, 10)]?.estado).toBe('por_aplicar')
    expect(aplicado(f.totales)).toBe(0)

    await validar(familia, 1)
    f = fila(await leer(), a)
    expect(f.meses[mesKey(ANIO, 9)]).toMatchObject({ estado: 'descontada', mesAplicacion: 1 })
    expect(f.totales).toMatchObject({ asignado: 9000, descontado: 5000, porAplicar: 4000 })
    expect(queda(f.totales)).toBe(4000)
  })

  it('desborde por transferencia: el exceso se reparte entre los hermanos y cuenta como aplicado', async () => {
    const familia = await createTestFamilia(centro.id)
    const a = await nino(familia, 'Nino Panel Hermano A', cuotaBaja)
    const b = await nino(familia, 'Nino Panel Hermano B', cuotaBaja)
    // Beca 5000 + 2500 = 7500 contra 6000 de cuota: 1500 no caben.
    await tramo(a, 11, 3, 5000)
    await tramo(b, 11, 3, 2500)
    await generar(3)

    let p = await leer()
    expect(fila(p, a).meses[mesKey(ANIO, 11)]).toMatchObject({
      estado: 'en_recibo',
      excesoCentimos: 1000,
      via: 'por_resolver',
    })
    expect(fila(p, b).meses[mesKey(ANIO, 11)]?.excesoCentimos).toBe(500)
    expect(p.totales.porResolver).toBe(1500)

    expect(await resolver(familia, 3, 'transferencia')).toBe(1500)
    await validar(familia, 3)
    p = await leer()
    expect(fila(p, a).totales).toMatchObject({ descontado: 4000, transferencia: 1000 })
    expect(fila(p, b).totales).toMatchObject({ descontado: 2000, transferencia: 500 })
    for (const id of [a, b]) {
      const t = fila(p, id).totales
      expect(aplicado(t)).toBe(t.asignado)
      expect(queda(t)).toBe(0)
    }
  })

  it('desborde diferido: lo que no cupo vuelve como resto y no se cuenta dos veces', async () => {
    const familia = await createTestFamilia(centro.id)
    const a = await nino(familia, 'Nino Panel Diferido', cuotaBaja)
    // Beca 5000 contra 3000 de cuota: 2000 no caben y se difieren al mes siguiente.
    await tramo(a, 12, 4, 5000)
    await generar(4)
    expect(await resolver(familia, 4, 'reducir')).toBe(2000)
    await tramo(a, 4, 5, 2000, 'resto')

    const f = fila(await leer(), a)
    expect(f.meses[mesKey(ANIO, 12)]).toMatchObject({ excesoCentimos: 2000, via: 'diferido' })
    expect(f.restos).toHaveLength(1)
    expect(f.restos[0]).toMatchObject({ importeCentimos: 2000, estado: 'por_aplicar' })
    expect(f.totales).toMatchObject({ asignado: 5000, enRecibo: 3000, porAplicar: 2000 })
    expect(aplicado(f.totales) + queda(f.totales)).toBe(5000)
  })

  it('la Dirección de otro centro no ve ninguna beca de este', async () => {
    const familia = await createTestFamilia(centro.id)
    const a = await nino(familia, 'Nino Panel Aislado', cuotaAlta)
    await tramo(a, 1, 6, 3000)
    // Control positivo: con la sesión del centro, sale.
    expect(fila(await leer(), a).totales.asignado).toBe(3000)

    const p = await leer(await clientFor(ajena))
    expect(p.filas).toEqual([])
    expect(p.totales.asignado).toBe(0)
  })
})
