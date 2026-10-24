import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * PR-8 — el descuento por hermano, fijo o porcentaje POR FAMILIA.
 *
 * Cada familia elige el tipo y el valor en su asignación (en la García 30 €, en la Pérez el 15 %
 * de la escolaridad del segundo hermano). El porcentaje se calcula SOBRE LA ESCOLARIDAD (la base
 * del concepto), no sobre todo lo que se le cobra a ese hermano. Sin valor propio, manda el
 * concepto. Aquí se mide contra la BD con lo que escribe la pantalla (el UPDATE de
 * `fijarImportePropio`, con la sesión de Dirección) y el motor real:
 *  - García, fijo propio sobre un descuento fijo; Pérez, porcentaje propio sobre el mismo
 *    concepto; una familia sin nada, el del concepto; y un importe propio que hace fijo un
 *    descuento porcentual;
 *  - el porcentaje no cuenta la matinera del hermano;
 *  - las puertas: importe y porcentaje juntos, porcentaje sin base, más del 100 %, quitar la base
 *    con porcentajes propios vivos, un cobro con base y un descuento porcentual sin base;
 *  - el export (art. 15) del tutor lleva el porcentaje propio de su familia.
 */

type ConceptoInsert = Database['public']['Tables']['conceptos_cobro']['Insert']

const ANIO = 2026
const MES = 3

describe('PR-8 — el descuento por hermano, fijo o porcentaje por familia', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let tutorPerez: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let cTutorPerez: Awaited<ReturnType<typeof clientFor>>
  let escolaridad: string
  let matinera: string
  let descuento: string
  let descuentoPct: string
  const familias: Record<'garcia' | 'perez' | 'catalogo' | 'equis', string> = {
    garcia: '',
    perez: '',
    catalogo: '',
    equis: '',
  }
  let ninoPerez2: string

  async function concepto(o: Partial<ConceptoInsert> & { nombre: string }) {
    return serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        ...o,
      })
      .select('id')
      .single()
  }

  async function conceptoOk(o: Partial<ConceptoInsert> & { nombre: string }): Promise<string> {
    const { data, error } = await concepto(o)
    if (error || !data) throw new Error(`concepto ${o.nombre}: ${error?.message}`)
    return data.id
  }

  async function familiaConDosHermanos(): Promise<{ familia: string; ninos: string[] }> {
    const familia = await createTestFamilia(centro.id)
    const ninos: string[] = []
    for (const i of [1, 2]) {
      const { data, error } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: familia,
          nombre: `Nino PR8 ${i}`,
          apellidos: 'Test',
          fecha_nacimiento: '2024-03-15',
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`nino: ${error?.message}`)
      await matricular(data.id, aula.id, curso.id)
      const asig = await serviceClient.from('asignacion_concepto').insert({
        centro_id: centro.id,
        concepto_id: escolaridad,
        nino_id: data.id,
        origen: 'manual',
      })
      if (asig.error) throw new Error(`escolaridad: ${asig.error.message}`)
      ninos.push(data.id)
    }
    return { familia, ninos }
  }

  async function asignarDescuento(conceptoId: string, familiaId: string) {
    const { error } = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      concepto_id: conceptoId,
      familia_id: familiaId,
      origen: 'manual',
    })
    if (error) throw new Error(`asignar descuento: ${error.message}`)
  }

  /** El UPDATE de `fijarImportePropio`: guardar uno borra el otro. */
  function fijar(
    conceptoId: string,
    familiaId: string,
    valor: { importe_override_centimos: number | null; porcentaje_override_bp: number | null }
  ) {
    return cAdmin
      .from('asignacion_concepto')
      .update(valor)
      .eq('centro_id', centro.id)
      .eq('concepto_id', conceptoId)
      .eq('familia_id', familiaId)
      .is('deleted_at', null)
      .select('id')
  }

  async function lineasDescuento(conceptoId: string, familiaId: string) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('importe_centimos, recibo:recibos!inner(familia_id, anio, mes)')
      .eq('concepto_id', conceptoId)
      .eq('recibo.familia_id', familiaId)
      .eq('recibo.anio', ANIO)
      .eq('recibo.mes', MES)
    return (data ?? []).map((l) => l.importe_centimos)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Descuento Hermano PR8')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Descuento PR8' })
    tutorPerez = await createTestUser({ nombre: 'Tutor Perez PR8' })
    await asignarRol(admin.id, centro.id, 'admin')

    escolaridad = await conceptoOk({ nombre: 'Escolaridad PR8', importe_centimos: 50000 })
    matinera = await conceptoOk({ nombre: 'Matinera PR8', importe_centimos: 3000 })
    // El CHECK relajado: un descuento FIJO con base.
    descuento = await conceptoOk({
      nombre: 'Descuento hermano PR8',
      signo: -1,
      ambito: 'familia',
      importe_centimos: 2000,
      concepto_base_id: escolaridad,
    })
    descuentoPct = await conceptoOk({
      nombre: 'Descuento hermano % PR8',
      signo: -1,
      ambito: 'familia',
      tipo_valor: 'porcentaje',
      porcentaje_bp: 1000,
      concepto_base_id: escolaridad,
    })

    familias.garcia = (await familiaConDosHermanos()).familia
    const perez = await familiaConDosHermanos()
    familias.perez = perez.familia
    ninoPerez2 = perez.ninos[1]!
    familias.catalogo = (await familiaConDosHermanos()).familia
    familias.equis = (await familiaConDosHermanos()).familia
    await crearFamiliaTutor(familias.perez, tutorPerez.id, 'titular')
    // La matinera, a un hermano Pérez: no entra en la base del porcentaje.
    const mat = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      concepto_id: matinera,
      nino_id: ninoPerez2,
      origen: 'manual',
    })
    if (mat.error) throw new Error(`matinera: ${mat.error.message}`)
    await asignarDescuento(descuento, familias.garcia)
    await asignarDescuento(descuento, familias.perez)
    await asignarDescuento(descuento, familias.catalogo)
    await asignarDescuento(descuentoPct, familias.equis)

    cAdmin = await clientFor(admin)
    cTutorPerez = await clientFor(tutorPerez)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
    await deleteTestUser(tutorPerez.id)
  }, 60_000)

  it('cada familia con su tipo y su valor; el porcentaje, solo sobre la escolaridad', async () => {
    const g = await fijar(descuento, familias.garcia, {
      importe_override_centimos: 3000,
      porcentaje_override_bp: null,
    })
    expect(g.error).toBeNull()
    expect(g.data).toHaveLength(1)
    const p = await fijar(descuento, familias.perez, {
      importe_override_centimos: null,
      porcentaje_override_bp: 1500,
    })
    expect(p.error).toBeNull()
    expect(p.data).toHaveLength(1)
    const x = await fijar(descuentoPct, familias.equis, {
      importe_override_centimos: 2500,
      porcentaje_override_bp: null,
    })
    expect(x.error).toBeNull()
    expect(x.data).toHaveLength(1)

    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(error).toBeNull()

    // Una sola línea por familia: el que más paga, completo; el otro hermano, con el descuento.
    expect(await lineasDescuento(descuento, familias.garcia)).toEqual([-3000])
    // 15 % de 500 €, no de 500 € + la matinera de 30 € (que serían -79,50 €).
    expect(await lineasDescuento(descuento, familias.perez)).toEqual([-7500])
    expect(await lineasDescuento(descuento, familias.catalogo)).toEqual([-2000])
    // El concepto es del 10 %, pero su importe propio de 25 € lo hace fijo.
    expect(await lineasDescuento(descuentoPct, familias.equis)).toEqual([-2500])
  })

  it('importe y porcentaje propios juntos: 23514', async () => {
    const r = await fijar(descuento, familias.perez, {
      importe_override_centimos: 1000,
      porcentaje_override_bp: 1500,
    })
    expect(r.error?.code).toBe('23514')
  })

  it('un porcentaje propio en un concepto sin base: 23514 con su motivo', async () => {
    const { data: asig } = await serviceClient
      .from('asignacion_concepto')
      .select('id')
      .eq('concepto_id', escolaridad)
      .eq('nino_id', ninoPerez2)
      .single()
    const r = await cAdmin
      .from('asignacion_concepto')
      .update({ porcentaje_override_bp: 1000 })
      .eq('id', asig!.id)
      .select('id')
    expect(r.error?.code).toBe('23514')
    expect(r.error?.hint).toBe('porcentaje_sin_base')
  })

  it('más del 100 %: 23514', async () => {
    const r = await fijar(descuento, familias.perez, {
      importe_override_centimos: null,
      porcentaje_override_bp: 10001,
    })
    expect(r.error?.code).toBe('23514')
  })

  it('un cobro no lleva base, y un descuento porcentual la exige', async () => {
    const cobro = await concepto({
      nombre: 'Cobro con base PR8',
      importe_centimos: 100,
      concepto_base_id: escolaridad,
    })
    expect(cobro.error?.code).toBe('23514')
    const sinBase = await concepto({
      nombre: 'Descuento % sin base PR8',
      signo: -1,
      ambito: 'familia',
      tipo_valor: 'porcentaje',
      porcentaje_bp: 500,
    })
    expect(sinBase.error?.code).toBe('23514')
  })

  it('la base no se quita con porcentajes propios vivos; sin ellos, sí', async () => {
    const r = await serviceClient
      .from('conceptos_cobro')
      .update({ concepto_base_id: null })
      .eq('id', descuento)
      .select('id')
    expect(r.error?.code).toBe('23514')
    expect(r.error?.hint).toBe('concepto_con_porcentajes_propios')

    // El export del tutor de la Pérez, antes de quitarle el porcentaje.
    const exp = await cTutorPerez.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutorPerez.id,
    })
    expect(exp.error).toBeNull()
    expect(JSON.stringify(exp.data)).toContain('"porcentaje_especial_bp":1500')

    const quitar = await fijar(descuento, familias.perez, {
      importe_override_centimos: null,
      porcentaje_override_bp: null,
    })
    expect(quitar.error).toBeNull()
    const r2 = await serviceClient
      .from('conceptos_cobro')
      .update({ concepto_base_id: null })
      .eq('id', descuento)
      .select('id')
    expect(r2.error).toBeNull()
    expect(r2.data).toHaveLength(1)
  })
})
