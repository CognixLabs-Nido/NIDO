import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * PR-13 — cargo puntual a varios niños de golpe (`20261116120000`), contra la BD real.
 *
 *  - Dirección elige niños de varias clases y cada uno recibe una línea MANUAL en el recibo del
 *    mes de su familia: en el borrador si lo hay; si no, en una carcasa nueva con el método
 *    congelado como el motor (la excepción del mes o el de la ficha). Los hermanos van al mismo
 *    recibo, una línea cada uno, y el total se recalcula.
 *  - La familia con el recibo validado no se toca: sale «no incluida».
 *  - Repetir el mismo cargo no lo duplica («ya incluido»).
 *  - El motor respeta el cargo al regenerar.
 *  - Fuera: la profe, el tutor, la Dirección de otro centro y el centro NULL (42501, sin escribir
 *    nada). Un niño de otro centro tumba el cargo ENTERO. Mes cerrado: P0001 «mes cerrado».
 *  - El concepto, si viene, es un esporádico del centro; el importe, mayor que 0 (22023).
 */

const ANIO = 2026
const MES = 11
const DESC = 'Excursión a la granja PR13'

type ArgsCargo = Database['public']['Functions']['anadir_cargo_puntual']['Args']

describe('PR-13 — cargo puntual a varios niños', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let famHermanos: string
  let famBorrador: string
  let famValidada: string
  let famSinRecibo: string
  let hermano1: string
  let hermano2: string
  let nBorrador: string
  let nValidada: string
  let nSinRecibo: string
  let nB: string
  let reciboBorrador: string
  let reciboValidado: string
  let excursion: string
  let mensual: string
  let excursionB: string
  const usuarios: TestUser[] = []
  let admin: TestUser
  let adminB: TestUser
  let profe: TestUser
  let tutor: TestUser

  async function usuario(nombre: string): Promise<TestUser> {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    return u
  }

  async function ninoEnFamilia(familiaId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroA.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'Demo',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`ninoEnFamilia: ${error?.message}`)
    return data.id
  }

  async function concepto(
    centroId: string,
    nombre: string,
    tipo: 'esporadico' | 'mensual'
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centroId,
        nombre,
        tipo_concepto: tipo,
        tipo_valor: 'fijo',
        importe_centimos: 1200,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    return data.id
  }

  async function recibo(familiaId: string, estado: 'borrador' | 'pendiente_procesar') {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        familia_id: familiaId,
        anio: ANIO,
        mes: MES,
        metodo: 'sepa',
        estado,
        total_centimos: 50000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    const linea = await serviceClient.from('lineas_recibo').insert({
      centro_id: centroA.id,
      recibo_id: data.id,
      descripcion: 'Escolaridad PR13',
      cantidad: 1,
      precio_unitario_centimos: 50000,
      importe_centimos: 50000,
    })
    if (linea.error) throw new Error(`linea: ${linea.error.message}`)
    return data.id
  }

  /** El recibo regular del mes de una familia, con sus líneas manuales. */
  async function reciboDe(familiaId: string, mes = MES) {
    const { data: r } = await serviceClient
      .from('recibos')
      .select('id, estado, metodo, total_centimos')
      .eq('familia_id', familiaId)
      .eq('anio', ANIO)
      .eq('mes', mes)
      .eq('es_esporadico', false)
      .is('devuelto_de_recibo_id', null)
      .is('deleted_at', null)
      .maybeSingle()
    if (!r) return { recibo: null, manuales: [] }
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('nino_id, concepto_id, descripcion, cantidad, importe_centimos, origen')
      .eq('recibo_id', r.id)
      .eq('origen', 'manual')
      .order('descripcion')
      .order('nino_id')
    return { recibo: r, manuales: lineas ?? [] }
  }

  async function lineasDelCentro(): Promise<number> {
    const { count } = await serviceClient
      .from('lineas_recibo')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centroA.id)
    return count ?? -1
  }

  function cargo(over: Partial<ArgsCargo> = {}): ArgsCargo {
    return {
      p_centro_id: centroA.id,
      p_anio: ANIO,
      p_mes: MES,
      p_nino_ids: [hermano1, hermano2, nBorrador, nValidada, nSinRecibo],
      p_descripcion: DESC,
      p_importe_centimos: 1200,
      p_concepto_id: excursion,
      ...over,
    }
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Cargo Puntual PR13')
    centroB = await createTestCentro('Otro Centro Cargo Puntual PR13')
    cursoA = await createTestCurso(centroA.id)
    const cursoB = await createTestCurso(centroB.id)
    const aula1 = await createTestAula(centroA.id, cursoA.id, 'Patitos PR13')
    const aula2 = await createTestAula(centroA.id, cursoA.id, 'Ositos PR13')
    const aulaB = await createTestAula(centroB.id, cursoB.id)

    famHermanos = await createTestFamilia(centroA.id)
    hermano1 = await ninoEnFamilia(famHermanos, 'Hermano Uno PR13')
    hermano2 = await ninoEnFamilia(famHermanos, 'Hermano Dos PR13')
    famBorrador = await createTestFamilia(centroA.id)
    nBorrador = await ninoEnFamilia(famBorrador, 'Nino Borrador PR13')
    famValidada = await createTestFamilia(centroA.id)
    nValidada = await ninoEnFamilia(famValidada, 'Nino Validada PR13')
    famSinRecibo = await createTestFamilia(centroA.id)
    nSinRecibo = await ninoEnFamilia(famSinRecibo, 'Nino Sin Recibo PR13')
    await matricular(hermano1, aula1.id, cursoA.id)
    await matricular(hermano2, aula2.id, cursoA.id)
    await matricular(nBorrador, aula1.id, cursoA.id)
    await matricular(nValidada, aula1.id, cursoA.id)
    await matricular(nSinRecibo, aula2.id, cursoA.id)
    const ninoB = await createTestNino(centroB.id, 'Nino Otro Centro PR13')
    nB = ninoB.id
    await matricular(nB, aulaB.id, cursoB.id)

    // El método de la carcasa: la ficha (transferencia) o la excepción del mes (efectivo).
    await serviceClient
      .from('familias')
      .update({ metodo_pago: 'transferencia' })
      .in('id', [famHermanos, famSinRecibo])
    const exc = await serviceClient.from('metodo_pago_familia').insert({
      centro_id: centroA.id,
      familia_id: famHermanos,
      anio: ANIO,
      mes: MES,
      metodo: 'efectivo',
    })
    if (exc.error) throw new Error(`excepción: ${exc.error.message}`)

    reciboBorrador = await recibo(famBorrador, 'borrador')
    reciboValidado = await recibo(famValidada, 'pendiente_procesar')
    excursion = await concepto(centroA.id, 'Excursión PR13', 'esporadico')
    mensual = await concepto(centroA.id, 'Material PR13', 'mensual')
    excursionB = await concepto(centroB.id, 'Excursión otro centro PR13', 'esporadico')

    admin = await usuario('Admin Cargo PR13')
    await asignarRol(admin.id, centroA.id, 'admin')
    adminB = await usuario('Admin Otro Centro Cargo PR13')
    await asignarRol(adminB.id, centroB.id, 'admin')
    profe = await usuario('Profe Cargo PR13')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarProfeAula(profe.id, aula1.id, cursoA.id)
    tutor = await usuario('Tutor Cargo PR13')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearVinculo(nBorrador, tutor.id, 'tutor_legal_principal')
  }, 120_000)

  afterAll(async () => {
    for (const c of [centroA, centroB]) {
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', c.id)
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('metodo_pago_familia').delete().eq('centro_id', c.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  it('Dirección carga a niños de dos clases: cada uno en el recibo de su familia', async () => {
    // Premisa: los hermanos y el de sin recibo no tienen recibo; el borrador vale 500 €.
    expect((await reciboDe(famHermanos)).recibo).toBeNull()
    expect((await reciboDe(famSinRecibo)).recibo).toBeNull()
    expect((await reciboDe(famBorrador)).recibo?.total_centimos).toBe(50000)

    const c = await clientFor(admin)
    const { data, error } = await c.rpc('anadir_cargo_puntual', cargo())
    expect(error).toBeNull()
    const por = new Map((data ?? []).map((f) => [f.nino_id, f]))
    expect(por.size).toBe(5)
    expect(por.get(hermano1)?.resultado).toBe('recibo_nuevo')
    expect(por.get(hermano2)?.resultado).toBe('recibo_nuevo')
    expect(por.get(nBorrador)?.resultado).toBe('incluido')
    expect(por.get(nSinRecibo)?.resultado).toBe('recibo_nuevo')
    expect(por.get(nValidada)).toMatchObject({
      resultado: 'no_incluido',
      estado: 'pendiente_procesar',
      recibo_id: reciboValidado,
    })

    // Los hermanos: un recibo, una línea cada uno, el método de la excepción del mes.
    const hermanos = await reciboDe(famHermanos)
    expect(hermanos.recibo).toMatchObject({
      estado: 'borrador',
      metodo: 'efectivo',
      total_centimos: 2400,
    })
    expect(hermanos.manuales.map((l) => l.nino_id).sort()).toEqual([hermano1, hermano2].sort())
    for (const l of hermanos.manuales) {
      expect(l).toMatchObject({
        concepto_id: excursion,
        descripcion: DESC,
        cantidad: 1,
        importe_centimos: 1200,
        origen: 'manual',
      })
    }
    // Sin excepción, el método de la ficha.
    expect((await reciboDe(famSinRecibo)).recibo).toMatchObject({
      metodo: 'transferencia',
      total_centimos: 1200,
    })
    // El borrador que ya había: el mismo recibo, con el total recalculado.
    const borrador = await reciboDe(famBorrador)
    expect(borrador.recibo?.id).toBe(reciboBorrador)
    expect(borrador.recibo?.total_centimos).toBe(51200)
    expect(borrador.manuales).toHaveLength(1)
    // El validado, intacto.
    const validado = await reciboDe(famValidada)
    expect(validado.recibo).toMatchObject({ estado: 'pendiente_procesar', total_centimos: 50000 })
    expect(validado.manuales).toEqual([])
  })

  it('repetir el mismo cargo no lo duplica; otro cargo distinto sí entra', async () => {
    const c = await clientFor(admin)
    const antes = await lineasDelCentro()
    const { data, error } = await c.rpc('anadir_cargo_puntual', cargo())
    expect(error).toBeNull()
    const resultados = new Map((data ?? []).map((f) => [f.nino_id, f.resultado]))
    for (const n of [hermano1, hermano2, nBorrador, nSinRecibo]) {
      expect(resultados.get(n)).toBe('ya_incluido')
    }
    expect(resultados.get(nValidada)).toBe('no_incluido')
    expect(await lineasDelCentro()).toBe(antes)
    expect((await reciboDe(famBorrador)).recibo?.total_centimos).toBe(51200)

    const otro = await c.rpc(
      'anadir_cargo_puntual',
      cargo({ p_nino_ids: [nBorrador], p_descripcion: 'Teatro PR13', p_importe_centimos: 800 })
    )
    expect(otro.error).toBeNull()
    expect(otro.data?.[0]?.resultado).toBe('incluido')
    expect((await reciboDe(famBorrador)).recibo?.total_centimos).toBe(52000)
  })

  it('el motor respeta el cargo al regenerar el mes', async () => {
    const c = await clientFor(admin)
    const { error } = await c.rpc('generar_recibos_mes', {
      p_centro_id: centroA.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(error).toBeNull()
    const hermanos = await reciboDe(famHermanos)
    expect(hermanos.manuales).toHaveLength(2)
    expect(hermanos.recibo?.total_centimos).toBe(2400)
    // La línea automática de la prueba se va (no hay conceptos asignados); los cargos se quedan.
    const borrador = await reciboDe(famBorrador)
    expect(borrador.recibo?.id).toBe(reciboBorrador)
    expect(borrador.manuales.map((l) => l.descripcion)).toEqual([DESC, 'Teatro PR13'])
    expect(borrador.recibo?.total_centimos).toBe(2000)
  })

  it('la profe, el tutor, la Dirección de otro centro y el centro NULL: 42501 sin escribir', async () => {
    const antes = await lineasDelCentro()
    // Control positivo delante: hay líneas que se podrían tocar.
    expect(antes).toBeGreaterThan(0)
    const nuevo = { p_descripcion: 'Cargo no autorizado PR13', p_importe_centimos: 500 }
    for (const u of [profe, tutor, adminB]) {
      const r = await (await clientFor(u)).rpc('anadir_cargo_puntual', cargo(nuevo))
      expect(r.error?.code).toBe('42501')
    }
    const nulo = await (
      await clientFor(admin)
    ).rpc('anadir_cargo_puntual', cargo({ ...nuevo, p_centro_id: null as unknown as string }))
    expect(nulo.error?.code).toBe('42501')
    expect(await lineasDelCentro()).toBe(antes)
  })

  it('un niño de otro centro tumba el cargo entero', async () => {
    const antes = await lineasDelCentro()
    const r = await (
      await clientFor(admin)
    ).rpc(
      'anadir_cargo_puntual',
      cargo({ p_nino_ids: [nBorrador, nB], p_descripcion: 'Cargo mezclado PR13' })
    )
    expect(r.error?.code).toBe('42501')
    expect(await lineasDelCentro()).toBe(antes)
    expect(
      (await reciboDe(famBorrador)).manuales.some((l) => l.descripcion === 'Cargo mezclado PR13')
    ).toBe(false)
  })

  it('un mes cerrado no admite cargos, con el mensaje que reconoce la acción', async () => {
    const { error: cierre } = await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centroA.id, anio: ANIO, mes: 3, cerrado_por: admin.id })
    expect(cierre).toBeNull()
    const r = await (await clientFor(admin)).rpc('anadir_cargo_puntual', cargo({ p_mes: 3 }))
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.message).toContain('mes cerrado')
    expect((await reciboDe(famSinRecibo, 3)).recibo).toBeNull()
  })

  it('el concepto es un esporádico del centro y el importe mayor que 0 (22023)', async () => {
    const antes = await lineasDelCentro()
    const c = await clientFor(admin)
    for (const over of [
      { p_concepto_id: mensual },
      { p_concepto_id: excursionB },
      { p_importe_centimos: 0 },
      { p_descripcion: '   ' },
      { p_nino_ids: [] },
    ]) {
      const r = await c.rpc('anadir_cargo_puntual', cargo(over))
      expect(r.error?.code, JSON.stringify(over)).toBe('22023')
    }
    expect(await lineasDelCentro()).toBe(antes)
  })
})
