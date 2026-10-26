import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Cada concepto se gestiona desde el propio concepto (`20261121120000`), contra la BD real.
 *
 *  - Dirección (también la directora) marca y desmarca de una vez a qué niños se asigna un
 *    concepto manual de niño, o a qué familias uno de familia: asignación manual, o borrado lógico
 *    al desmarcar. Repetir no cambia nada. Queda en `audit_log` con quien guarda como actor.
 *  - El motor cobra lo marcado.
 *  - Fuera: la profe, el tutor y la Dirección de otro centro (42501, sin escribir nada). Un niño de
 *    otro centro, o un niño en un concepto de familia, tumba el guardado ENTERO (42501).
 *  - Solo conceptos activos y manuales, como Asignación permanente: P0001 `concepto_no_asignable`.
 *  - Una lista vacía o con repetidos: 22023.
 */

const ANIO = 2026
const MES = 12

describe('Asignaciones desde el propio concepto', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let famA1: string
  let famA2: string
  let nino1: string
  let nino2: string
  let nino3: string
  let ninoB: string
  let comedorMensual: string
  let cargoFamilia: string
  let automatico: string
  let inactivo: string
  const usuarios: TestUser[] = []
  let directora: TestUser
  let adminB: TestUser
  let profe: TestUser
  let tutor: TestUser

  async function usuario(nombre: string): Promise<TestUser> {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    return u
  }

  async function nino(centroId: string, familiaId: string, nombre: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        nombre,
        apellidos: 'Demo',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    return data.id
  }

  async function concepto(
    centroId: string,
    nombre: string,
    over: { ambito?: 'nino' | 'familia'; aplicacion?: 'manual' | 'automatico'; activo?: boolean }
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centroId,
        nombre,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        importe_centimos: 15000,
        ambito: over.ambito ?? 'nino',
        aplicacion: over.aplicacion ?? 'manual',
        activo: over.activo ?? true,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto: ${error?.message}`)
    return data.id
  }

  /** Las asignaciones vivas de un concepto: los niños o las familias que lo tienen. */
  async function vivas(conceptoId: string): Promise<string[]> {
    const { data } = await serviceClient
      .from('asignacion_concepto')
      .select('nino_id, familia_id')
      .eq('concepto_id', conceptoId)
      .is('deleted_at', null)
    return (data ?? []).map((a) => (a.nino_id ?? a.familia_id) as string).sort()
  }

  async function filasDelCentro(): Promise<number> {
    const { count } = await serviceClient
      .from('asignacion_concepto')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centroA.id)
    return count ?? -1
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Desde Concepto')
    centroB = await createTestCentro('Otro Centro Desde Concepto')
    const cursoA = await createTestCurso(centroA.id)
    const cursoB = await createTestCurso(centroB.id)
    const aula1 = await createTestAula(centroA.id, cursoA.id, 'Patitos Concepto')
    const aula2 = await createTestAula(centroA.id, cursoA.id, 'Ositos Concepto')
    const aulaB = await createTestAula(centroB.id, cursoB.id)

    famA1 = await createTestFamilia(centroA.id)
    famA2 = await createTestFamilia(centroA.id)
    nino1 = await nino(centroA.id, famA1, 'Nino Uno Concepto')
    nino2 = await nino(centroA.id, famA2, 'Nino Dos Concepto')
    nino3 = await nino(centroA.id, famA2, 'Nino Tres Concepto')
    await matricular(nino1, aula1.id, cursoA.id)
    await matricular(nino2, aula2.id, cursoA.id)
    await matricular(nino3, aula2.id, cursoA.id)
    const famB = await createTestFamilia(centroB.id)
    ninoB = await nino(centroB.id, famB, 'Nino Otro Centro Concepto')
    await matricular(ninoB, aulaB.id, cursoB.id)

    comedorMensual = await concepto(centroA.id, 'Comedor Mensual Concepto', {})
    cargoFamilia = await concepto(centroA.id, 'Cargo Familia Concepto', { ambito: 'familia' })
    automatico = await concepto(centroA.id, 'Escolaridad Concepto', { aplicacion: 'automatico' })
    inactivo = await concepto(centroA.id, 'Inactivo Concepto', { activo: false })

    directora = await usuario('Directora Desde Concepto')
    await asignarRol(directora.id, centroA.id, 'directora')
    adminB = await usuario('Admin Otro Centro Desde Concepto')
    await asignarRol(adminB.id, centroB.id, 'admin')
    profe = await usuario('Profe Desde Concepto')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarProfeAula(profe.id, aula1.id, cursoA.id)
    tutor = await usuario('Tutor Desde Concepto')
    await asignarRol(tutor.id, centroA.id, 'tutor_legal')
    await crearVinculo(nino1, tutor.id, 'tutor_legal_principal')
  }, 120_000)

  afterAll(async () => {
    for (const c of [centroA, centroB]) {
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', c.id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  it('la directora marca a dos niños: asignación manual, con ella como actor', async () => {
    // Premisa: nadie tiene el concepto.
    expect(await vivas(comedorMensual)).toEqual([])

    const c = await clientFor(directora)
    const { data, error } = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorMensual,
      p_cambios: [
        { id: nino1, asignada: true },
        { id: nino2, asignada: true },
      ],
    })
    expect(error).toBeNull()
    expect(new Map((data ?? []).map((f) => [f.destinatario_id, f.resultado]))).toEqual(
      new Map([
        [nino1, 'asignada'],
        [nino2, 'asignada'],
      ])
    )
    expect(await vivas(comedorMensual)).toEqual([nino1, nino2].sort())

    const { data: filas } = await serviceClient
      .from('asignacion_concepto')
      .select('id, centro_id, origen, familia_id')
      .eq('concepto_id', comedorMensual)
      .is('deleted_at', null)
    for (const f of filas ?? []) {
      expect(f).toMatchObject({ centro_id: centroA.id, origen: 'manual', familia_id: null })
    }
    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('usuario_id')
      .eq('tabla', 'asignacion_concepto')
      .eq('accion', 'INSERT')
      .in(
        'registro_id',
        (filas ?? []).map((f) => f.id)
      )
    expect(audit?.map((a) => a.usuario_id)).toEqual([directora.id, directora.id])
  })

  it('repetir no cambia nada; desmarcar es borrado lógico', async () => {
    const c = await clientFor(directora)
    const antes = await filasDelCentro()
    const { data, error } = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorMensual,
      p_cambios: [
        { id: nino1, asignada: true },
        { id: nino2, asignada: false },
        { id: nino3, asignada: false },
      ],
    })
    expect(error).toBeNull()
    expect(new Map((data ?? []).map((f) => [f.destinatario_id, f.resultado]))).toEqual(
      new Map([
        [nino1, 'sin_cambio'],
        [nino2, 'quitada'],
        [nino3, 'sin_cambio'],
      ])
    )
    expect(await vivas(comedorMensual)).toEqual([nino1])
    // La fila de nino2 sigue, con deleted_at: nada se borra de verdad.
    expect(await filasDelCentro()).toBe(antes)
  })

  it('el motor cobra lo marcado desde el concepto', async () => {
    const { error } = await (
      await clientFor(directora)
    ).rpc('generar_recibos_mes', { p_centro_id: centroA.id, p_anio: ANIO, p_mes: MES })
    expect(error).toBeNull()
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('nino_id, importe_centimos')
      .eq('centro_id', centroA.id)
      .eq('concepto_id', comedorMensual)
    expect(lineas).toEqual([{ nino_id: nino1, importe_centimos: 15000 }])
  })

  it('un concepto de familia se marca por familias', async () => {
    const c = await clientFor(directora)
    const { error } = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: cargoFamilia,
      p_cambios: [{ id: famA2, asignada: true }],
    })
    expect(error).toBeNull()
    expect(await vivas(cargoFamilia)).toEqual([famA2])
    const { data: fila } = await serviceClient
      .from('asignacion_concepto')
      .select('nino_id, familia_id')
      .eq('concepto_id', cargoFamilia)
      .is('deleted_at', null)
      .single()
    expect(fila).toEqual({ nino_id: null, familia_id: famA2 })
  })

  it('un niño de otro centro, o un niño en un concepto de familia, tumba el guardado entero', async () => {
    const c = await clientFor(directora)
    const antes = await filasDelCentro()
    const mezclado = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorMensual,
      p_cambios: [
        { id: nino3, asignada: true },
        { id: ninoB, asignada: true },
      ],
    })
    expect(mezclado.error?.code).toBe('42501')
    const ninoEnFamilia = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: cargoFamilia,
      p_cambios: [{ id: nino1, asignada: true }],
    })
    expect(ninoEnFamilia.error?.code).toBe('42501')
    expect(await filasDelCentro()).toBe(antes)
    expect(await vivas(comedorMensual)).toEqual([nino1])
  })

  it('la profe, el tutor y la Dirección de otro centro: 42501 sin escribir', async () => {
    const antes = await filasDelCentro()
    // Control positivo delante: hay asignaciones que se podrían tocar.
    expect(await vivas(comedorMensual)).toEqual([nino1])
    for (const u of [profe, tutor, adminB]) {
      const r = await (
        await clientFor(u)
      ).rpc('fijar_asignaciones_concepto', {
        p_concepto_id: comedorMensual,
        p_cambios: [
          { id: nino1, asignada: false },
          { id: nino3, asignada: true },
        ],
      })
      expect(r.error?.code).toBe('42501')
    }
    expect(await filasDelCentro()).toBe(antes)
    expect(await vivas(comedorMensual)).toEqual([nino1])
  })

  it('un concepto automático o desactivado no se asigna desde aquí', async () => {
    const c = await clientFor(directora)
    for (const id of [automatico, inactivo]) {
      const r = await c.rpc('fijar_asignaciones_concepto', {
        p_concepto_id: id,
        p_cambios: [{ id: nino1, asignada: true }],
      })
      expect(r.error?.code).toBe('P0001')
      expect(r.error?.hint).toBe('concepto_no_asignable')
      expect(await vivas(id)).toEqual([])
    }
  })

  it('una lista vacía o con repetidos: 22023', async () => {
    const c = await clientFor(directora)
    const vacia = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorMensual,
      p_cambios: [],
    })
    expect(vacia.error?.code).toBe('22023')
    const repetidos = await c.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorMensual,
      p_cambios: [
        { id: nino3, asignada: true },
        { id: nino3, asignada: false },
      ],
    })
    expect(repetidos.error?.code).toBe('22023')
    expect(await vivas(comedorMensual)).toEqual([nino1])
  })
})
