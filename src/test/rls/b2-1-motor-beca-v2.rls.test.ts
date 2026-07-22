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
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * B2-1 — MOTOR: beca comedor v2 aplicada por MES DE APLICACIÓN + capado a ≥0 con
 * preservación de saldo + detección de desborde.
 *
 * Cubre: aplicación por (anio_aplicacion, mes_aplicacion) = mes generado (desacople) con
 * descripción por el mes CORRESPONDIENTE; varios tramos en el mismo recibo; beca que no
 * desborda; desborde con base>0 (capado a 0 + ajuste + fila desborde); saldo a favor
 * (base<0: beca no descuenta, saldo intacto, todo exceso); D-P3 (tramo previo a una baja
 * SE aplica); idempotencia (regenerar sin duplicar desborde).
 *
 * Requiere B2-0 (tablas) Y B2-1 (motor + FK) aplicadas.
 * Gateado: BECA_COMEDOR_V2_MOTOR_APPLIED=1.
 */

const APPLIED = process.env.BECA_COMEDOR_V2_MOTOR_APPLIED === '1'

type TramoInsert = Database['public']['Tables']['beca_comedor_tramo']['Insert']

describe.skipIf(!APPLIED)('B2-1 — motor beca comedor v2', () => {
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>
  const ANIO = 2027
  const MES = 1 // se genera enero; los tramos corresponden a meses anteriores

  const centros: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin B2-1' })
    cAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    for (const id of centros) {
      await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', id)
      await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', id)
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', id)
      await serviceClient.from('recibos').delete().eq('centro_id', id)
      await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', id)
      await serviceClient.from('beca_comedor_elegibilidad').delete().eq('centro_id', id)
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', id)
      await deleteTestCentro(id)
    }
    await deleteTestUser(admin.id)
  })

  // Entorno aislado por test: centro + curso + aula, admin reutilizado.
  async function nuevoEntorno(): Promise<{ centro: string; curso: string; aula: string }> {
    const centro = await createTestCentro('B2-1 motor')
    centros.push(centro.id)
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    await asignarRol(admin.id, centro.id, 'admin')
    return { centro: centro.id, curso: curso.id, aula: aula.id }
  }

  async function nuevoNino(
    centro: string,
    curso: string,
    aula: string
  ): Promise<{ nino: string; familia: string }> {
    const familia = await createTestFamilia(centro)
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro,
        familia_id: familia,
        nombre: 'N',
        apellidos: 'T',
        fecha_nacimiento: '2024-05-10',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nuevoNino: ${error?.message}`)
    await matricular(data.id, aula, curso)
    return { nino: data.id, familia }
  }

  // Escolaridad (mensual, niño) con importe por override en la asignación.
  async function darEscolaridad(centro: string, nino: string, centimos: number) {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centro,
        nombre: 'Escolaridad ' + nino.slice(0, 8),
        tipo_concepto: 'mensual',
        activo: true,
        signo: 1,
        ambito: 'nino',
        aplicacion: 'manual',
        tipo_valor: 'fijo',
        importe_centimos: centimos,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`darEscolaridad: ${error?.message}`)
    const asig = await serviceClient
      .from('asignacion_concepto')
      .insert({
        centro_id: centro,
        concepto_id: data.id,
        nino_id: nino,
        origen: 'manual',
        importe_override_centimos: centimos,
      })
    if (asig.error) throw new Error(`asignar escolaridad: ${asig.error.message}`)
  }

  async function seedTramo(
    row: Partial<TramoInsert> & { centro_id: string; nino_id: string; curso_academico_id: string }
  ) {
    const { error } = await serviceClient.from('beca_comedor_tramo').insert({
      anio_correspondiente: 2026,
      anio_aplicacion: ANIO,
      mes_aplicacion: MES,
      importe_centimos: 5000,
      ...row,
    } as TramoInsert)
    if (error) throw new Error(`seedTramo: ${error.message}`)
  }

  const gen = (centro: string) =>
    cAdmin.rpc('generar_recibos_mes', { p_centro_id: centro, p_anio: ANIO, p_mes: MES })

  async function reciboFamilia(familia: string) {
    const { data: recibo } = await serviceClient
      .from('recibos')
      .select('id, total_centimos')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', MES)
      .eq('es_esporadico', false)
      .is('devuelto_de_recibo_id', null)
      .is('deleted_at', null)
      .maybeSingle()
    if (!recibo) return { recibo: null, lineas: [] as Array<Record<string, unknown>> }
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('descripcion, importe_centimos, nino_id')
      .eq('recibo_id', recibo.id)
    return { recibo, lineas: lineas ?? [] }
  }

  it('aplica por MES DE APLICACIÓN con descripción del MES CORRESPONDIENTE (desacople)', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 30000)
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 5000,
    })
    await gen(e.centro)
    const { recibo, lineas } = await reciboFamilia(familia)
    const beca = lineas.find((l) => (l.descripcion as string).startsWith('Beca comedor'))
    expect(beca?.descripcion).toBe('Beca comedor octubre') // mes correspondiente, no el de aplicación
    expect(beca?.importe_centimos).toBe(-5000)
    expect(recibo?.total_centimos).toBe(25000) // 30000 - 5000
  })

  it('varios tramos en el mismo recibo (enero = sep+oct+nov)', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 30000)
    for (const mc of [9, 10, 11])
      await seedTramo({
        centro_id: e.centro,
        nino_id: nino,
        curso_academico_id: e.curso,
        mes_correspondiente: mc,
        importe_centimos: 5000,
      })
    await gen(e.centro)
    const { recibo, lineas } = await reciboFamilia(familia)
    const becas = lineas.filter((l) => (l.descripcion as string).startsWith('Beca comedor'))
    expect(becas).toHaveLength(3)
    expect((becas.map((b) => b.descripcion) as string[]).sort()).toEqual([
      'Beca comedor noviembre',
      'Beca comedor octubre',
      'Beca comedor septiembre',
    ])
    expect(recibo?.total_centimos).toBe(15000) // 30000 - 15000
  })

  it('beca que NO desborda deja el recibo positivo, sin fila de desborde', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 10000)
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 4000,
    })
    await gen(e.centro)
    const { recibo, lineas } = await reciboFamilia(familia)
    expect(recibo?.total_centimos).toBe(6000)
    expect(lineas.find((l) => (l.descripcion as string).startsWith('Ajuste'))).toBeUndefined()
    const { data: desb } = await serviceClient
      .from('beca_comedor_desborde')
      .select('id')
      .eq('familia_id', familia)
    expect(desb).toHaveLength(0)
  })

  it('desborde con base>0: recibo a 0 + línea de ajuste + fila desborde con exceso', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 3000)
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 5000,
    })
    await gen(e.centro)
    const { recibo, lineas } = await reciboFamilia(familia)
    expect(recibo?.total_centimos).toBe(0) // capado
    const ajuste = lineas.find((l) => (l.descripcion as string).startsWith('Ajuste'))
    expect(ajuste?.importe_centimos).toBe(2000)
    expect(ajuste?.nino_id).toBeNull() // línea familiar
    const { data: desb } = await serviceClient
      .from('beca_comedor_desborde')
      .select('cuota_total_centimos, beca_total_centimos, exceso_centimos, estado')
      .eq('familia_id', familia)
      .single()
    expect(desb).toMatchObject({
      cuota_total_centimos: 3000,
      beca_total_centimos: 5000,
      exceso_centimos: 2000,
      estado: 'pendiente',
    })
  })

  it('SALDO A FAVOR (base<0): la beca no descuenta, el saldo queda intacto, todo es exceso', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    // Sin escolaridad; saldo a favor del mes anterior (dic-2026 = -5000).
    await serviceClient
      .from('recibos')
      .insert({
        centro_id: e.centro,
        familia_id: familia,
        anio: 2026,
        mes: 12,
        estado: 'cobrado_manual',
        total_centimos: -5000,
        es_esporadico: false,
      })
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 3000,
    })
    await gen(e.centro)
    const { recibo, lineas } = await reciboFamilia(familia)
    expect(recibo?.total_centimos).toBe(-5000) // saldo a favor INTACTO (la beca no lo tocó)
    expect(lineas.find((l) => l.descripcion === 'Saldo mes anterior')?.importe_centimos).toBe(-5000)
    expect(
      lineas.find((l) => (l.descripcion as string).startsWith('Beca comedor'))?.importe_centimos
    ).toBe(-3000)
    expect(
      lineas.find((l) => (l.descripcion as string).startsWith('Ajuste'))?.importe_centimos
    ).toBe(3000)
    const { data: desb } = await serviceClient
      .from('beca_comedor_desborde')
      .select('cuota_total_centimos, exceso_centimos')
      .eq('familia_id', familia)
      .single()
    expect(desb).toMatchObject({ cuota_total_centimos: 0, exceso_centimos: 3000 }) // cuota positiva = 0
  })

  it('D-P3: un tramo registrado antes de una BAJA de elegibilidad SE aplica', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 10000)
    // elegibilidad de BAJA + tramo (el motor no consulta la elegibilidad).
    await serviceClient
      .from('beca_comedor_elegibilidad')
      .insert({
        centro_id: e.centro,
        nino_id: nino,
        curso_academico_id: e.curso,
        activa: false,
        fecha_baja: '2026-12-01',
      })
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 4000,
    })
    await gen(e.centro)
    const { lineas } = await reciboFamilia(familia)
    expect(
      lineas.find((l) => (l.descripcion as string).startsWith('Beca comedor'))?.importe_centimos
    ).toBe(-4000)
  })

  it('idempotencia: regenerar dos veces no duplica el desborde', async () => {
    const e = await nuevoEntorno()
    const { nino, familia } = await nuevoNino(e.centro, e.curso, e.aula)
    await darEscolaridad(e.centro, nino, 3000)
    await seedTramo({
      centro_id: e.centro,
      nino_id: nino,
      curso_academico_id: e.curso,
      mes_correspondiente: 10,
      importe_centimos: 5000,
    })
    await gen(e.centro)
    const g2 = await gen(e.centro)
    expect(g2.error).toBeNull()
    const { data: desb } = await serviceClient
      .from('beca_comedor_desborde')
      .select('id')
      .eq('familia_id', familia)
    expect(desb).toHaveLength(1) // no duplicado (FK CASCADE limpia el anterior)
  })
})
