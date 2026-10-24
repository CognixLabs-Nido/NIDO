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
 * PR-10 — la carga de beca comedor por alumno (sin migración: el importe ya vivía en cada tramo).
 *
 * Contra la BD real, con la sesión de Dirección y las mismas escrituras que hacen
 * `crearCarga`/`editarCarga`:
 *  - cada becado recibe en su recibo SU importe, no uno común;
 *  - un becado marcado DESPUÉS de la carga entra en ella con un tramo nuevo, sin rehacerla;
 *  - un alumno no tiene dos tramos normales del mismo mes (el índice que sostiene el plan);
 *  - lo que dice el aviso del formulario: con el recibo de esa familia ya validado, la beca nueva
 *    no entra; vuelto a borrador y recalculado, sí.
 *
 * UN MES POR TEST: validar el último borrador de un mes lo cierra.
 */

const ANIO = 2026

describe('PR-10 — carga de beca comedor por alumno', () => {
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
        nombre: 'Nino PR10',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    // Cuota mayor que cualquier beca del test: sin desborde, que no dejaría validar (PR-3).
    const asig = await serviceClient
      .from('asignacion_concepto')
      .insert({ centro_id: centro.id, nino_id: data.id, concepto_id: cuota, origen: 'manual' })
    if (asig.error) throw new Error(`asignar: ${asig.error.message}`)
    return { familia, nino: data.id }
  }

  /** Marcar becado, como `toggleElegibilidad`. */
  async function becar(nino: string) {
    const { error } = await cAdmin.from('beca_comedor_elegibilidad').insert({
      centro_id: centro.id,
      nino_id: nino,
      curso_academico_id: curso.id,
      activa: true,
    })
    expect(error).toBeNull()
  }

  /** Los tramos de una carga, como los inserta `escribirPlan` (sesión de Dirección). */
  function insertarTramos(mesCorr: number, mesAplic: number, filas: Array<[string, number]>) {
    return cAdmin.from('beca_comedor_tramo').insert(
      filas.map(([nino_id, importe_centimos]) => ({
        centro_id: centro.id,
        nino_id,
        curso_academico_id: curso.id,
        anio_correspondiente: ANIO,
        mes_correspondiente: mesCorr,
        anio_aplicacion: ANIO,
        mes_aplicacion: mesAplic,
        importe_centimos,
        origen: 'normal' as const,
        estado: 'pendiente' as const,
      }))
    )
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

  /** Las líneas de beca comedor del recibo (las que llevan tramo). */
  async function becaEnRecibo(familia: string, mes: number): Promise<number[]> {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos')
      .eq('recibo_id', await recibo(familia, mes))
      .not('beca_tramo_id', 'is', null)
    return (data ?? []).map((l) => l.importe_centimos).sort((a, b) => a - b)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Beca por Alumno PR10')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Beca por Alumno PR10' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Cuota PR10',
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
    await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_elegibilidad').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('premisa: cada becado recibe SU importe, no uno común', async () => {
    const a = await familiaConNino()
    const b = await familiaConNino()
    await becar(a.nino)
    await becar(b.nino)
    expect(
      (
        await insertarTramos(9, 1, [
          [a.nino, 5000],
          [b.nino, 3250],
        ])
      ).error
    ).toBeNull()
    await generar(1)
    expect(await becaEnRecibo(a.familia, 1)).toEqual([-5000])
    expect(await becaEnRecibo(b.familia, 1)).toEqual([-3250])
  })

  it('el becado marcado DESPUÉS de la carga entra en ella sin rehacerla', async () => {
    const a = await familiaConNino()
    const tardio = await familiaConNino()
    await becar(a.nino)
    expect((await insertarTramos(10, 2, [[a.nino, 4000]])).error).toBeNull()
    await generar(2)
    expect(await becaEnRecibo(tardio.familia, 2)).toEqual([])

    // Se le marca becado y se añade su tramo a la MISMA carga (editarCarga).
    await becar(tardio.nino)
    expect((await insertarTramos(10, 2, [[tardio.nino, 2500]])).error).toBeNull()
    await generar(2)
    expect(await becaEnRecibo(tardio.familia, 2)).toEqual([-2500])
    // La carga sigue siendo una: la del primero, intacta.
    expect(await becaEnRecibo(a.familia, 2)).toEqual([-4000])
  })

  it('un alumno no tiene dos tramos normales del mismo mes correspondiente (23505)', async () => {
    const a = await familiaConNino()
    await becar(a.nino)
    expect((await insertarTramos(11, 3, [[a.nino, 4000]])).error).toBeNull()
    const doble = await insertarTramos(11, 3, [[a.nino, 1000]])
    expect(doble.error?.code).toBe('23505')
  })

  it('cambiar el importe de un tramo pendiente cambia lo que descuenta el recibo', async () => {
    const a = await familiaConNino()
    await becar(a.nino)
    expect((await insertarTramos(12, 4, [[a.nino, 4000]])).error).toBeNull()
    await generar(4)
    expect(await becaEnRecibo(a.familia, 4)).toEqual([-4000])
    const { error } = await cAdmin
      .from('beca_comedor_tramo')
      .update({ importe_centimos: 4500 })
      .eq('centro_id', centro.id)
      .eq('nino_id', a.nino)
      .eq('mes_correspondiente', 12)
    expect(error).toBeNull()
    await generar(4)
    expect(await becaEnRecibo(a.familia, 4)).toEqual([-4500])
  })

  it('el aviso dice verdad: con el recibo validado no entra; en borrador y recalculado, sí', async () => {
    const tardio = await familiaConNino()
    // Otra familia en borrador: el mes sigue abierto aunque se valide el del becado tardío.
    const otra = await familiaConNino()
    await generar(5)
    const r = await recibo(tardio.familia, 5)
    expect((await cAdmin.rpc('confirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    const { data: cierre } = await serviceClient
      .from('cierre_mensual')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', ANIO)
      .eq('mes', 5)
    expect(cierre).toEqual([]) // premisa: el mes no se ha cerrado
    expect(await recibo(otra.familia, 5)).toBeTruthy()

    await becar(tardio.nino)
    expect((await insertarTramos(1, 5, [[tardio.nino, 3000]])).error).toBeNull()
    await generar(5)
    expect(await becaEnRecibo(tardio.familia, 5)).toEqual([])

    expect((await cAdmin.rpc('desconfirmar_recibo', { p_recibo_id: r })).error).toBeNull()
    await generar(5)
    expect(await becaEnRecibo(tardio.familia, 5)).toEqual([-3000])
  })
})
