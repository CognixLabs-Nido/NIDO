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
 * R-2 — el motor PRESERVA lo escrito a mano.
 *
 * `generar_recibos_mes` era wipe+rebuild: borraba el borrador entero y lo recreaba con id
 * nuevo, así que una línea escrita a mano moría por CASCADE. Ahora el reset vacía SOLO las
 * líneas `origen='automatico'` y reutiliza la carcasa. Esta suite fija ese contrato y las
 * cuatro implicaciones que arrastró, cada una de las cuales fue un bug real durante R-2:
 *
 *   (a) `beca_comedor_desborde` tiene UNIQUE(recibo_id) y se limpiaba por CASCADE. Sin
 *       borrado explícito, la 2.ª regeneración muere con 23505 y aborta TODO el mes.
 *   (b) el descarte "si 0 líneas" cuenta el recibo entero → un recibo cuyas únicas líneas
 *       sean manuales no se autodestruye.
 *   (c) la base del TOPE de la beca comedor incluye las manuales (decisión C1).
 *   (d) las bases del PASE 3 que DERIVAN un descuento NO las incluyen (decisión A): un
 *       cargo a mano no debe inflar un porcentaje ni mover el descuento de hermanos.
 *
 * Gateado: R2_MIGRATION_APPLIED=1 (requiere `20260827120000_phase_recibos_r2_origen_lineas`).
 */

const APPLIED = process.env.R2_MIGRATION_APPLIED === '1'

type AsignacionInsert = Database['public']['Tables']['asignacion_concepto']['Insert']

const ANIO = 2026
const MES = 6

async function insertarNino(centroId: string, familiaId: string, nombre: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroId,
      familia_id: familiaId,
      nombre,
      apellidos: 'Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insertarNino: ${error?.message}`)
  return data.id
}

interface MkConcepto {
  nombre: string
  tipo_valor?: 'fijo' | 'porcentaje'
  signo?: number
  ambito?: 'nino' | 'familia'
  importe_centimos?: number | null
  porcentaje_bp?: number | null
  concepto_base_id?: string | null
}

async function mkConcepto(centroId: string, o: MkConcepto): Promise<string> {
  const { data, error } = await serviceClient
    .from('conceptos_cobro')
    .insert({
      centro_id: centroId,
      nombre: o.nombre,
      tipo_concepto: 'mensual',
      tipo_valor: o.tipo_valor ?? 'fijo',
      signo: o.signo ?? 1,
      ambito: o.ambito ?? 'nino',
      importe_centimos: o.importe_centimos ?? null,
      porcentaje_bp: o.porcentaje_bp ?? null,
      concepto_base_id: o.concepto_base_id ?? null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`mkConcepto ${o.nombre}: ${error?.message}`)
  return data.id
}

async function asignar(row: Partial<AsignacionInsert> & { concepto_id: string }): Promise<void> {
  const { error } = await serviceClient
    .from('asignacion_concepto')
    .insert({ origen: 'manual', ...row } as AsignacionInsert)
  if (error) throw new Error(`asignar: ${error.message}`)
}

/** Una línea tal como la lee la suite (el `origen` es lo que aquí importa). */
interface LineaFila {
  id: string
  nino_id: string | null
  concepto_id: string | null
  descripcion: string
  importe_centimos: number
  origen: string
}

/** El recibo regular del mes y sus líneas. */
async function reciboRegular(familiaId: string) {
  const { data: recibo } = await serviceClient
    .from('recibos')
    .select('id, estado, total_centimos')
    .eq('familia_id', familiaId)
    .eq('anio', ANIO)
    .eq('mes', MES)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (!recibo) return { recibo: null, lineas: [] as LineaFila[] }
  const { data: lineas } = await serviceClient
    .from('lineas_recibo')
    .select('id, nino_id, concepto_id, descripcion, importe_centimos, origen')
    .eq('recibo_id', recibo.id)
  return { recibo, lineas: lineas ?? [] }
}

/** Escribe una línea A MANO en el borrador, como hace la action de R-3. */
async function lineaManual(
  centroId: string,
  reciboId: string,
  descripcion: string,
  importeCentimos: number,
  extra: { nino_id?: string | null; concepto_id?: string | null } = {}
): Promise<string> {
  const { data, error } = await serviceClient
    .from('lineas_recibo')
    .insert({
      centro_id: centroId,
      recibo_id: reciboId,
      nino_id: extra.nino_id ?? null,
      concepto_id: extra.concepto_id ?? null,
      descripcion,
      cantidad: 1,
      precio_unitario_centimos: importeCentimos,
      importe_centimos: importeCentimos,
      origen: 'manual',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`lineaManual: ${error?.message}`)
  return data.id
}

describe.skipIf(!APPLIED)('R-2 — el motor preserva las líneas manuales', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let cAdmin: Awaited<ReturnType<typeof clientFor>>

  beforeAll(async () => {
    centro = await createTestCentro('Centro R2 manuales')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin R2' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', centro.id)
    await serviceClient.from('beca_comedor_tramo').delete().eq('centro_id', centro.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('asignacion_concepto').delete().eq('centro_id', centro.id)
    await serviceClient.from('conceptos_cobro').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  async function generar() {
    const { error } = await cAdmin.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: MES,
    })
    return error
  }

  it('la línea manual sobrevive a DOS regeneraciones, con el mismo recibo, y las automáticas se rehacen', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 A')
    await matricular(nino, aula.id, curso.id)
    const escolaridad = await mkConcepto(centro.id, {
      nombre: 'R2 Escolaridad',
      importe_centimos: 50000,
    })
    await asignar({ centro_id: centro.id, concepto_id: escolaridad, nino_id: nino })

    expect(await generar()).toBeNull()
    const inicial = await reciboRegular(familia)
    expect(inicial.recibo).not.toBeNull()
    const idOriginal = inicial.recibo!.id
    expect(inicial.lineas).toHaveLength(1)

    await lineaManual(centro.id, idOriginal, 'Material a mano', 12345, { nino_id: nino })

    for (const vuelta of [1, 2]) {
      expect(await generar(), `regeneración ${vuelta}`).toBeNull()
      const tras = await reciboRegular(familia)
      // El id ESTABLE es lo que permite que la manual siga colgando del mismo recibo.
      expect(tras.recibo!.id, `regeneración ${vuelta}: el recibo se recreó`).toBe(idOriginal)
      const manuales = tras.lineas.filter((l) => l.origen === 'manual')
      const automaticas = tras.lineas.filter((l) => l.origen === 'automatico')
      expect(manuales, `regeneración ${vuelta}: la manual desapareció`).toHaveLength(1)
      expect(manuales[0]!.importe_centimos).toBe(12345)
      expect(automaticas).toHaveLength(1)
      expect(tras.recibo!.total_centimos).toBe(50000 + 12345)
    }
  })

  it('(b) un recibo que se queda SOLO con líneas manuales no se autodestruye', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 B')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota B', importe_centimos: 30000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })

    expect(await generar()).toBeNull()
    const { recibo } = await reciboRegular(familia)
    await lineaManual(centro.id, recibo!.id, 'Solo esto queda', 5000, { nino_id: nino })

    // Se le retira el concepto: sin manuales, el motor descartaría el recibo por vacío.
    await serviceClient
      .from('asignacion_concepto')
      .update({ deleted_at: new Date().toISOString() })
      .eq('nino_id', nino)

    expect(await generar()).toBeNull()
    const tras = await reciboRegular(familia)
    expect(tras.recibo, 'el recibo con solo manuales fue descartado').not.toBeNull()
    expect(tras.lineas).toHaveLength(1)
    expect(tras.lineas[0]!.origen).toBe('manual')
    expect(tras.recibo!.total_centimos).toBe(5000)
  })

  it('(a) regenerar dos veces con desborde de beca NO revienta con 23505 ni duplica el desborde', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 C')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota C', importe_centimos: 10000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })

    // Tramo de beca MUY superior a la cuota → desborde garantizado.
    const { error: errTramo } = await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: nino,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: MES,
      anio_aplicacion: ANIO,
      mes_aplicacion: MES,
      importe_centimos: 90000,
      estado: 'pendiente',
    })
    expect(errTramo).toBeNull()

    expect(await generar()).toBeNull()
    // La 2.ª pasada es la que moría: el desborde anterior seguía vivo y UNIQUE(recibo_id)
    // hacía fallar el INSERT, abortando la generación de TODO el centro.
    expect(await generar(), 'la 2.ª regeneración falló (¿falta borrar el desborde?)').toBeNull()

    const { data: desbordes } = await serviceClient
      .from('beca_comedor_desborde')
      .select('id')
      .eq('familia_id', familia)
    expect(desbordes ?? []).toHaveLength(1)
  })

  it('(c) C1: la base del TOPE de la beca comedor INCLUYE las líneas manuales', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 D')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota D', importe_centimos: 10000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })
    await serviceClient.from('beca_comedor_tramo').insert({
      centro_id: centro.id,
      nino_id: nino,
      curso_academico_id: curso.id,
      anio_correspondiente: ANIO,
      mes_correspondiente: MES,
      anio_aplicacion: ANIO,
      mes_aplicacion: MES,
      importe_centimos: 90000,
      estado: 'pendiente',
    })

    expect(await generar()).toBeNull()
    const { data: sinManual } = await serviceClient
      .from('beca_comedor_desborde')
      .select('cuota_total_centimos')
      .eq('familia_id', familia)
      .single()
    expect(sinManual!.cuota_total_centimos).toBe(10000)

    const { recibo } = await reciboRegular(familia)
    await lineaManual(centro.id, recibo!.id, 'Excursión a mano', 50000)

    expect(await generar()).toBeNull()
    const { data: conManual } = await serviceClient
      .from('beca_comedor_desborde')
      .select('cuota_total_centimos')
      .eq('familia_id', familia)
      .single()
    // 100 € de catálogo + 500 € a mano: la beca puede descontar contra los 600 €.
    expect(conManual!.cuota_total_centimos).toBe(60000)
  })

  it('(d) decisión A: un cargo manual con el concepto base NO infla el descuento porcentual', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 E')
    await matricular(nino, aula.id, curso.id)
    const base = await mkConcepto(centro.id, { nombre: 'R2 Base E', importe_centimos: 10000 })
    const pct = await mkConcepto(centro.id, {
      nombre: 'R2 Dto 10% E',
      signo: -1,
      tipo_valor: 'porcentaje',
      porcentaje_bp: 1000,
      concepto_base_id: base,
    })
    await asignar({ centro_id: centro.id, concepto_id: base, nino_id: nino })
    await asignar({ centro_id: centro.id, concepto_id: pct, nino_id: nino })

    expect(await generar()).toBeNull()
    const antes = await reciboRegular(familia)
    expect(antes.lineas.find((l) => l.concepto_id === pct)!.importe_centimos).toBe(-1000)

    // 900 € a mano CON el concepto base: sin el filtro, el 10 % pasaría a -100 €.
    await lineaManual(centro.id, antes.recibo!.id, 'Manual con concepto base', 90000, {
      nino_id: nino,
      concepto_id: base,
    })

    expect(await generar()).toBeNull()
    const despues = await reciboRegular(familia)
    expect(despues.lineas.find((l) => l.concepto_id === pct)!.importe_centimos).toBe(-1000)
  })

  it('(d) decisión A: un cargo manual NO cambia a qué hermano le toca el descuento', async () => {
    const familia = await createTestFamilia(centro.id)
    const mayor = await insertarNino(centro.id, familia, 'Nino R2 F1')
    const menor = await insertarNino(centro.id, familia, 'Nino R2 F2')
    await matricular(mayor, aula.id, curso.id)
    await matricular(menor, aula.id, curso.id)
    const cuota = await mkConcepto(centro.id, { nombre: 'R2 Cuota F', importe_centimos: 40000 })
    const hermanos = await mkConcepto(centro.id, {
      nombre: 'R2 Hermanos F',
      signo: -1,
      ambito: 'familia',
      importe_centimos: 5000,
    })
    await asignar({ centro_id: centro.id, concepto_id: cuota, nino_id: mayor })
    await asignar({ centro_id: centro.id, concepto_id: cuota, nino_id: menor })
    await asignar({ centro_id: centro.id, concepto_id: hermanos, familia_id: familia })

    expect(await generar()).toBeNull()
    const antes = await reciboRegular(familia)
    const beneficiario = antes.lineas.find((l) => l.concepto_id === hermanos)!.nino_id
    expect(beneficiario).not.toBeNull()

    // Cargo gordo a mano AL QUE HOY recibe el descuento: sin el filtro pasaría a ser "el que
    // más paga" y el descuento saltaría al otro hermano.
    await lineaManual(centro.id, antes.recibo!.id, 'Manual gordo', 500000, {
      nino_id: beneficiario,
    })

    expect(await generar()).toBeNull()
    const despues = await reciboRegular(familia)
    expect(despues.lineas.find((l) => l.concepto_id === hermanos)!.nino_id).toBe(beneficiario)
  })

  it('ciclo B1 (R-3): editar una línea AUTOMÁTICA la vuelve manual y sobrevive a regenerar', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 I')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota I', importe_centimos: 40000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })

    expect(await generar()).toBeNull()
    const antes = await reciboRegular(familia)
    expect(antes.lineas).toHaveLength(1)
    expect(antes.lineas[0]!.origen).toBe('automatico')

    // Exactamente lo que hace `editarLineaRecibo`: cambia el importe Y marca la línea como
    // manual. Sin esa marca, la regeneración siguiente la borraría y la recalcularía a
    // 400 € — la edición sería trabajo perdido, que es el bug que B1 cierra.
    const { error: errEdit } = await serviceClient
      .from('lineas_recibo')
      .update({
        descripcion: 'Cuota pactada con la familia',
        precio_unitario_centimos: 15000,
        importe_centimos: 15000,
        origen: 'manual',
      })
      .eq('id', antes.lineas[0]!.id)
    expect(errEdit).toBeNull()

    expect(await generar()).toBeNull()
    const despues = await reciboRegular(familia)

    const editada = despues.lineas.find((l) => l.origen === 'manual')
    expect(editada, 'la línea editada no sobrevivió').toBeDefined()
    expect(editada!.importe_centimos).toBe(15000)
    expect(editada!.descripcion).toBe('Cuota pactada con la familia')

    // Y el motor vuelve a poner SU línea, porque la asignación sigue viva: la edición
    // manual no desasigna el concepto, solo deja de ser la misma fila.
    const automatica = despues.lineas.find((l) => l.origen === 'automatico')
    expect(automatica!.importe_centimos).toBe(40000)
    expect(despues.recibo!.total_centimos).toBe(15000 + 40000)
  })

  it('equivalencia: sin líneas manuales, regenerar deja el mismo resultado que antes', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 G')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota G', importe_centimos: 25000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })

    expect(await generar()).toBeNull()
    const primera = await reciboRegular(familia)
    expect(await generar()).toBeNull()
    const segunda = await reciboRegular(familia)

    expect(segunda.recibo!.total_centimos).toBe(primera.recibo!.total_centimos)
    expect(segunda.lineas).toHaveLength(primera.lineas.length)
    expect(segunda.lineas.every((l) => l.origen === 'automatico')).toBe(true)
  })

  it('un recibo CONFIRMADO no se toca al regenerar, ni siquiera sus líneas automáticas', async () => {
    const familia = await createTestFamilia(centro.id)
    const nino = await insertarNino(centro.id, familia, 'Nino R2 H')
    await matricular(nino, aula.id, curso.id)
    const concepto = await mkConcepto(centro.id, { nombre: 'R2 Cuota H', importe_centimos: 33000 })
    await asignar({ centro_id: centro.id, concepto_id: concepto, nino_id: nino })

    expect(await generar()).toBeNull()
    const antes = await reciboRegular(familia)
    await serviceClient
      .from('recibos')
      .update({ estado: 'pendiente_procesar' })
      .eq('id', antes.recibo!.id)

    // Se sube el precio del catálogo: si el motor tocara el confirmado, el total cambiaría.
    await serviceClient
      .from('conceptos_cobro')
      .update({ importe_centimos: 99000 })
      .eq('id', concepto)

    expect(await generar()).toBeNull()
    const despues = await reciboRegular(familia)
    expect(despues.recibo!.id).toBe(antes.recibo!.id)
    expect(despues.recibo!.total_centimos).toBe(antes.recibo!.total_centimos)
    expect(despues.lineas).toHaveLength(antes.lineas.length)
  })
})
