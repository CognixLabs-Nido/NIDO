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
 * Los conceptos diarios son automáticos (`20261122120000`): el día suelto lo tienen todos.
 *
 * Decisión del responsable: «el niño va a comedor y no paga cuota mensual, se le cobra el día
 * suelto». El motor solo cobra los días del parte con el diario asignado, así que lo tiene que
 * tener todo el mundo; a quien tiene la cuota mensual del mismo servicio no le cobra el día (PR-4).
 *
 *  - Un diario no puede ser manual: ni al crearlo ni después (CHECK, también con service role).
 *  - `proponer_asignaciones` se lo da a todos los niños matriculados.
 *  - El motor cobra los días del parte a quien no tiene la cuota mensual, y a quien la tiene no.
 *  - Desde el propio concepto no se eligen niños: `fijar_asignaciones_concepto` lo rechaza.
 */

const ANIO = 2026
const MES = 6
const DIAS = ['2026-06-02', '2026-06-03']

describe('Los conceptos diarios son automáticos', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  let sinCuota: string
  let conCuota: string
  let comedorDia: string
  let comedorMensual: string

  async function nino(nombre: string): Promise<string> {
    const familia = await createTestFamilia(centro.id)
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre,
        apellidos: 'Demo',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nino: ${error?.message}`)
    await matricular(data.id, aula.id, curso.id)
    return data.id
  }

  async function lineas(ninoId: string, conceptoId: string) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select('cantidad, importe_centimos')
      .eq('nino_id', ninoId)
      .eq('concepto_id', conceptoId)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Diario Automatico')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Diario Automatico' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    sinCuota = await nino('Nino Sin Cuota Diario')
    conCuota = await nino('Nino Con Cuota Diario')

    const mensual = await cAdmin
      .from('conceptos_cobro')
      .insert({
        centro_id: centro.id,
        nombre: 'Comedor Mensual Diario Automatico',
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        importe_centimos: 15000,
        servicio: 'comedor',
        aplicacion: 'manual',
      })
      .select('id')
      .single()
    if (mensual.error || !mensual.data) throw new Error(`mensual: ${mensual.error?.message}`)
    comedorMensual = mensual.data.id
    const asig = await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      nino_id: conCuota,
      concepto_id: comedorMensual,
      origen: 'manual',
    })
    if (asig.error) throw new Error(`asignar mensual: ${asig.error.message}`)

    const parte = await serviceClient.from('parte_servicio_diario').insert(
      [sinCuota, conCuota].flatMap((n) =>
        DIAS.map((fecha) => ({
          centro_id: centro.id,
          nino_id: n,
          fecha,
          servicio: 'comedor' as const,
          presente: true,
        }))
      )
    )
    if (parte.error) throw new Error(`parte: ${parte.error.message}`)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  }, 60_000)

  it('un diario manual no se crea; el mismo, automático, sí', async () => {
    const fila = {
      centro_id: centro.id,
      nombre: 'Comedor dia Diario Automatico',
      tipo_concepto: 'diario' as const,
      tipo_valor: 'fijo',
      importe_centimos: 700,
      servicio: 'comedor' as const,
    }
    // Sin `aplicacion`: el DEFAULT de la columna es 'manual'.
    const manual = await cAdmin.from('conceptos_cobro').insert(fila).select('id').maybeSingle()
    expect(manual.error?.code).toBe('23514')
    expect(manual.error?.message).toContain('conceptos_cobro_diario_automatico')
    const porServicio = await serviceClient
      .from('conceptos_cobro')
      .insert({ ...fila, aplicacion: 'manual' })
      .select('id')
      .maybeSingle()
    expect(porServicio.error?.message).toContain('conceptos_cobro_diario_automatico')

    // Control positivo: la misma fila, automática, entra.
    const auto = await cAdmin
      .from('conceptos_cobro')
      .insert({ ...fila, aplicacion: 'automatico' })
      .select('id')
      .single()
    expect(auto.error).toBeNull()
    comedorDia = auto.data!.id
  })

  it('un diario no pasa a manual después', async () => {
    const r = await cAdmin
      .from('conceptos_cobro')
      .update({ aplicacion: 'manual' })
      .eq('id', comedorDia)
      .select('id')
      .maybeSingle()
    expect(r.error?.code).toBe('23514')
    const { data } = await serviceClient
      .from('conceptos_cobro')
      .select('aplicacion')
      .eq('id', comedorDia)
      .single()
    expect(data?.aplicacion).toBe('automatico')
  })

  it('proponer se lo da a todos los niños matriculados', async () => {
    // Premisa: todavía no lo tiene nadie.
    const antes = await serviceClient
      .from('asignacion_concepto')
      .select('nino_id')
      .eq('concepto_id', comedorDia)
    expect(antes.data).toEqual([])

    const { error } = await cAdmin.rpc('proponer_asignaciones', { p_centro_id: centro.id })
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('asignacion_concepto')
      .select('nino_id, origen')
      .eq('concepto_id', comedorDia)
      .is('deleted_at', null)
    expect((data ?? []).map((a) => a.nino_id).sort()).toEqual([sinCuota, conCuota].sort())
    expect(new Set((data ?? []).map((a) => a.origen))).toEqual(new Set(['automatico']))
  })

  it('el parte manda: días a quien no tiene la cuota mensual, y a quien la tiene, no', async () => {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    expect(error).toBeNull()
    expect(await lineas(sinCuota, comedorDia)).toEqual([{ cantidad: 2, importe_centimos: 1400 }])
    expect(await lineas(conCuota, comedorDia)).toEqual([])
    expect(await lineas(conCuota, comedorMensual)).toEqual([
      { cantidad: 1, importe_centimos: 15000 },
    ])
  })

  it('desde el concepto no se eligen niños de un diario', async () => {
    const r = await cAdmin.rpc('fijar_asignaciones_concepto', {
      p_concepto_id: comedorDia,
      p_cambios: [{ id: sinCuota, asignada: false }],
    })
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.hint).toBe('concepto_no_asignable')
  })
})
