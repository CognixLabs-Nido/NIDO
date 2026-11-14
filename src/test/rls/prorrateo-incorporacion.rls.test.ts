import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Prorrateo del mes de incorporación (`20270121120000`).
 *
 * Jose (2026-11-14): el mes de la incorporación se cobra por días naturales desde el día de entrada,
 * que cuenta. «Escolaridad de 400 €, incorporación el 15 de septiembre → 16 días de 30 → 213,33 €.»
 * Solo las mensuales sin servicio y los descuentos fijos del niño, con la misma fracción; los de
 * porcentaje salen de la base ya prorrateada. Al céntimo, y los empates hacia arriba en valor
 * absoluto. Los recibos se cobran por adelantado: aquí se generan ANTES de la fecha, como pasará.
 *
 * Y la corrección a mano manda (decisión del responsable, 2026-11-14): Dirección corrige la línea en
 * el borrador y el motor ya no vuelve a poner la automática al lado.
 */

const ESCOLARIDAD = 40_000
const BECA = 40_000
const COMEDOR_MENSUAL = 15_000
const COMEDOR_DIA = 1_200
const HERMANOS = 5_000

/** Septiembre del año que viene: siempre después de hoy, y siempre de 30 días. */
const ANIO = Number(hoyMadrid().slice(0, 4)) + 1
const MES = 9
const SEPT = (dia: number) => `${ANIO}-09-${String(dia).padStart(2, '0')}`

describe('Prorrateo del mes de incorporación', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  const c: Record<string, string> = {}

  async function concepto(clave: string, fila: Record<string, unknown>) {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        aplicacion: 'manual',
        ...fila,
      } as never)
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto ${clave}: ${error?.message}`)
    c[clave] = data.id
  }

  async function asignar(
    conceptoClave: string,
    destino: { nino_id?: string; familia_id?: string }
  ) {
    const { error } = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      concepto_id: c[conceptoClave]!,
      origen: 'manual',
      ...destino,
    } as never)
    if (error) throw new Error(`asignar ${conceptoClave}: ${error.message}`)
  }

  /** Un niño matriculado, incorporado el día que se diga, con sus conceptos. */
  async function nino(nombre: string, fecha: string, conceptos: string[], familia?: string) {
    let n: { id: string }
    if (familia) {
      // Un hermano: se inserta ya en la familia, como en `fecha-incorporacion.rls.test.ts`.
      const ins = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: familia,
          nombre,
          primer_apellido: 'Test',
          fecha_nacimiento: '2025-03-15',
          fecha_incorporacion: fecha,
        })
        .select('id')
        .single()
      if (ins.error || !ins.data) throw new Error(`hermano: ${ins.error?.message}`)
      n = ins.data
    } else {
      n = await createTestNino(centro.id, nombre)
      const f = await serviceClient
        .from('ninos')
        .update({ fecha_incorporacion: fecha })
        .eq('id', n.id)
      if (f.error) throw new Error(`fecha: ${f.error.message}`)
    }
    await matricular(n.id, aula.id, curso.id)
    for (const k of conceptos) await asignar(k, { nino_id: n.id })
    const { data } = await serviceClient
      .from('ninos')
      .select('fecha_incorporacion, familia_id')
      .eq('id', n.id)
      .single()
    expect(data!.fecha_incorporacion).toBe(fecha) // premisa: matricular no la pisa
    return { id: n.id, familia_id: data!.familia_id as string }
  }

  async function generar(anio: number, mes: number) {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: anio,
      p_mes: mes,
    })
    expect(error).toBeNull()
  }

  interface Linea {
    id: string
    concepto_id: string | null
    descripcion: string
    cantidad: number
    importe_centimos: number
    origen: string
  }

  /** Las líneas de un niño en el recibo regular del mes. En dos pasos: el embebido es ambiguo. */
  async function lineas(ninoId: string, anio: number, mes: number): Promise<Linea[]> {
    const r = await serviceClient
      .from('recibos')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', anio)
      .eq('mes', mes)
      .eq('es_esporadico', false)
    if (r.error) throw new Error(`recibos: ${r.error.message}`)
    const ids = (r.data ?? []).map((x) => x.id)
    if (ids.length === 0) return []
    const { data, error } = await serviceClient
      .from('lineas_recibo')
      .select('id, concepto_id, descripcion, cantidad, importe_centimos, origen')
      .eq('nino_id', ninoId)
      .in('recibo_id', ids)
    if (error) throw new Error(`líneas: ${error.message}`)
    return (data ?? []) as Linea[]
  }

  const de = (ls: Linea[], k: string) => ls.filter((l) => l.concepto_id === c[k])
  const importe = (ls: Linea[], k: string) => de(ls, k).map((l) => l.importe_centimos)

  let entra15: { id: string; familia_id: string }
  let siempre: { id: string; familia_id: string }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Prorrateo')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Prorrateo' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)

    await concepto('escolaridad', { nombre: 'Escolaridad P', importe_centimos: ESCOLARIDAD })
    await concepto('beca', { nombre: 'Beca P', signo: -1, importe_centimos: BECA })
    await concepto('pct', {
      nombre: 'Descuento 10% P',
      signo: -1,
      tipo_valor: 'porcentaje',
      porcentaje_bp: 1000,
      concepto_base_id: c.escolaridad,
    })
    await concepto('comedorMensual', {
      nombre: 'Comedor mensual P',
      servicio: 'comedor',
      importe_centimos: COMEDOR_MENSUAL,
    })
    await concepto('comedorDia', {
      nombre: 'Comedor día P',
      tipo_concepto: 'diario',
      servicio: 'comedor',
      importe_centimos: COMEDOR_DIA,
      // Un diario es siempre automático (CHECK `conceptos_cobro_diario_automatico`).
      aplicacion: 'automatico',
    })
    await concepto('pico', { nombre: 'Pico P', importe_centimos: 45 })
    await concepto('picoDto', { nombre: 'Pico dto P', signo: -1, importe_centimos: 45 })
    await concepto('hermanos', {
      nombre: 'Hermanos P',
      signo: -1,
      ambito: 'familia',
      importe_centimos: HERMANOS,
    })

    entra15 = await nino('Entra el 15', SEPT(15), ['escolaridad', 'beca', 'pct', 'comedorMensual'])
    siempre = await nino('Desde siempre', '2000-01-01', ['escolaridad', 'beca', 'pct'])
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('el ejemplo de Jose, generado antes de que llegue la fecha: 16 de 30 días', async () => {
    expect(hoyMadrid() < SEPT(15)).toBe(true) // premisa: se genera por adelantado
    await generar(ANIO, MES)

    // Control: al incorporado desde siempre se le cobra el mes entero (el prorrateo no es global).
    const s = await lineas(siempre.id, ANIO, MES)
    expect(importe(s, 'escolaridad')).toEqual([ESCOLARIDAD])
    expect(importe(s, 'beca')).toEqual([-BECA])

    const l = await lineas(entra15.id, ANIO, MES)
    // 400 € × 16/30 = 213,333… → 213,33 €: un caso que no es exacto, para fijar el redondeo.
    expect(de(l, 'escolaridad')).toMatchObject([
      { descripcion: 'Escolaridad P (16 de 30 días)', cantidad: 1, importe_centimos: 21_333 },
    ])
    // La beca fija, con la misma fracción y simétrica: el recibo no sale a favor.
    expect(de(l, 'beca')).toMatchObject([
      { descripcion: 'Beca P (16 de 30 días)', importe_centimos: -21_333 },
    ])
    // El 10 %, sobre la base ya prorrateada (21.333 × 0,1 = 2.133,3 → 2.133), no prorrateado otra vez.
    expect(importe(l, 'pct')).toEqual([-2_133])
    // La mensual de servicio no se toca.
    expect(importe(l, 'comedorMensual')).toEqual([COMEDOR_MENSUAL])
  })

  it('el redondeo: los empates, hacia arriba en valor absoluto y simétricos', async () => {
    const n = await nino('Entra el 30', SEPT(30), ['pico', 'picoDto'])
    await generar(ANIO, MES)
    const l = await lineas(n.id, ANIO, MES)
    // 0,45 € × 1/30 = 0,015 € = 1,5 céntimos: un empate. Cargo 2, descuento −2.
    expect(importe(l, 'pico')).toEqual([2])
    expect(importe(l, 'picoDto')).toEqual([-2])
  })

  it('los bordes: el día 1 es el mes entero, y el mes siguiente también', async () => {
    const n = await nino('Entra el 1', SEPT(1), ['escolaridad', 'beca'])
    await generar(ANIO, MES)
    const l = await lineas(n.id, ANIO, MES)
    expect(de(l, 'escolaridad')).toMatchObject([
      { descripcion: 'Escolaridad P', importe_centimos: ESCOLARIDAD },
    ])
    // El descuento llama siempre a la descripción del prorrateo: el día 1 no lleva días.
    expect(de(l, 'beca')).toMatchObject([{ descripcion: 'Beca P', importe_centimos: -BECA }])

    await generar(ANIO, MES + 1)
    const oct = await lineas(entra15.id, ANIO, MES + 1)
    expect(importe(oct, 'escolaridad')).toEqual([ESCOLARIDAD])
    expect(importe(oct, 'beca')).toEqual([-BECA])
  })

  it('los diarios van por el parte, sin prorrateo', async () => {
    const n = await nino('Diario', SEPT(15), ['comedorDia'])
    const parte = await serviceClient.from('parte_servicio_diario').insert(
      [SEPT(16), SEPT(17)].map((fecha) => ({
        centro_id: centro.id,
        nino_id: n.id,
        fecha,
        servicio: 'comedor' as const,
        presente: true,
      }))
    )
    expect(parte.error).toBeNull()
    await generar(ANIO, MES)
    expect(importe(await lineas(n.id, ANIO, MES), 'comedorDia')).toEqual([2 * COMEDOR_DIA])
  })

  it('el descuento de hermanos fijo, con la fracción del hermano que lo recibe', async () => {
    const mayor = await nino('Hermano mayor', '2000-01-01', ['escolaridad'])
    const menor = await nino('Hermano menor', SEPT(15), ['escolaridad'], mayor.familia_id)
    expect(menor.familia_id).toBe(mayor.familia_id) // premisa: son hermanos
    await asignar('hermanos', { familia_id: mayor.familia_id })
    await generar(ANIO, MES)
    // El menor paga menos (prorrateado), así que le toca el descuento: 50 € × 16/30 = 26,67 €.
    expect(importe(await lineas(mayor.id, ANIO, MES), 'hermanos')).toEqual([])
    expect(importe(await lineas(menor.id, ANIO, MES), 'hermanos')).toEqual([-2_667])
  })

  it('Dirección corrige la propuesta y la corrección manda, con su rastro en la auditoría', async () => {
    const antes = await lineas(entra15.id, ANIO, MES)
    const propuesta = de(antes, 'escolaridad')
    expect(propuesta).toMatchObject([{ origen: 'automatico', importe_centimos: 21_333 }]) // premisa

    // Lo que hace `editarLineaRecibo`, con la sesión de Dirección: importe y origen manual.
    const { error } = await cAdmin
      .from('lineas_recibo')
      .update({
        descripcion: 'Escolaridad pactada',
        cantidad: 1,
        precio_unitario_centimos: 25_000,
        importe_centimos: 25_000,
        origen: 'manual',
      })
      .eq('id', propuesta[0]!.id)
    expect(error).toBeNull()

    await generar(ANIO, MES)
    const despues = await lineas(entra15.id, ANIO, MES)
    // Una sola escolaridad: la corregida. La automática no vuelve.
    expect(de(despues, 'escolaridad')).toMatchObject([
      { id: propuesta[0]!.id, origen: 'manual', importe_centimos: 25_000 },
    ])
    // Los descuentos se siguen derivando del catálogo (decisión A): la beca y el 10 % no cambian.
    expect(importe(despues, 'beca')).toEqual([-21_333])
    expect(importe(despues, 'pct')).toEqual([-2_133])

    const { data: rastro, error: e2 } = await serviceClient
      .from('audit_log')
      .select('usuario_id, accion')
      .eq('tabla', 'lineas_recibo')
      .eq('registro_id', propuesta[0]!.id)
      .eq('accion', 'UPDATE')
    expect(e2).toBeNull()
    expect(rastro).toEqual([{ usuario_id: admin.id, accion: 'UPDATE' }])
  })
})
