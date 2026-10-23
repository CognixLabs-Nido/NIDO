import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * PR-2 (`20261107120000`) — una devolución se resuelve UNA sola vez.
 *
 *  - Al registrar la devolución se guardan la fecha que dice el banco y los gastos (0 si no hay),
 *    sin tocar el total del recibo.
 *  - La salida cobra total + gastos: banco (un re-giro SEPA, solo con mandato activo), efectivo o
 *    transferencia (el recibo queda cobrado y conserva sus fechas de banco).
 *  - Una segunda salida se rechaza, también si llegan las dos a la vez.
 *  - Por otro camino que no sea la función no se resuelve (trigger), tampoco con service_role: ni
 *    cobrar a mano un devuelto, ni crear un re-giro, ni poner la salida.
 *  - Lo resuelve Dirección; el actor de audit_log es quien resuelve, sin la nota; el export del
 *    art. 15 lleva los gastos y la salida.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ENVIO = '2026-01-05'
const DEVOLUCION = '2026-01-20'
const COBRO = '2026-01-25'

describe('PR-2 — devoluciones con una sola salida', () => {
  let centro: { id: string }
  let familiaSin: string
  let familiaCon: string
  let directora: TestUser
  let tutora: TestUser
  let tutoraCon: TestUser
  let cDirectora: SupabaseClient<Database>
  let cTutora: SupabaseClient<Database>

  /** Un recibo ya enviado al banco (esporádico SEPA, para no chocar con el único regular). */
  async function enviado(familia: string, over: Partial<Recibo> = {}): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 1,
        estado: 'enviado_banco',
        metodo: 'sepa',
        fecha_envio_banco: ENVIO,
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Devolución PR-2',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  function devolver(id: string, gastos: number | null = 350, fecha = DEVOLUCION) {
    return cDirectora
      .from('recibos')
      .update({ estado: 'devuelto', fecha_devolucion: fecha, devolucion_gastos_centimos: gastos })
      .eq('id', id)
      .select('id')
      .maybeSingle()
  }

  async function devuelto(familia: string, gastos = 350, over: Partial<Recibo> = {}) {
    const id = await enviado(familia, over)
    const { error } = await devolver(id, gastos)
    if (error) throw new Error(`devolver: ${error.message}`)
    return id
  }

  function resolver(
    cliente: SupabaseClient<Database>,
    id: string,
    salida: string,
    fecha: string | null = null,
    nota: string | null = null
  ) {
    return cliente.rpc('resolver_devolucion', {
      p_recibo_id: id,
      p_salida: salida,
      p_fecha: fecha as string,
      p_nota: nota as string,
    })
  }

  async function fila(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select(
        'estado, total_centimos, fecha_envio_banco, fecha_devolucion, devolucion_gastos_centimos, devolucion_salida, cobro_forma, cobro_fecha'
      )
      .eq('id', id)
      .single()
    return data
  }

  async function regirosDe(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, estado, metodo, total_centimos, anio, mes, familia_id')
      .eq('devuelto_de_recibo_id', id)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Devolucion PR2')
    const ninoSin = await createTestNino(centro.id, 'Nino Devolucion Sin Mandato')
    const ninoCon = await createTestNino(centro.id, 'Nino Devolucion Con Mandato')
    familiaSin = ninoSin.familia_id
    familiaCon = ninoCon.familia_id

    directora = await createTestUser({ nombre: 'Directora Devolucion PR2' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)

    tutora = await createTestUser({ nombre: 'Tutora Devolucion PR2' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaSin, tutora.id)
    cTutora = await clientFor(tutora)

    // La otra familia firma su mandato SEPA (camino real del alta).
    tutoraCon = await createTestUser({ nombre: 'Tutora Devolucion Con Mandato' })
    await asignarRol(tutoraCon.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaCon, tutoraCon.id)
    const cTutoraCon = await clientFor(tutoraCon)
    const { error } = await cTutoraCon.rpc('registrar_mandato_sepa', {
      p_familia_id: familiaCon,
      p_nino_id: ninoCon.id,
      p_iban: 'ES7620770024003102575766',
      p_titular: 'Tutora Devolucion Con Mandato',
      p_identificador_mandato: 'NIDO-PR2-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Tutora Devolucion Con Mandato',
      p_texto_hash: 'b'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-01-01T10:00:00Z',
    } as never)
    if (error) throw new Error(`mandato: ${error.message}`)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centro.id)
    // Los re-giros referencian al original con ON DELETE RESTRICT: primero ellos.
    await serviceClient
      .from('recibos')
      .delete()
      .eq('centro_id', centro.id)
      .not('devuelto_de_recibo_id', 'is', null)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestUser(tutora.id)
    await deleteTestUser(tutoraCon.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('premisa: la directora lee el recibo, y solo una de las dos familias tiene mandato activo', async () => {
    const id = await enviado(familiaSin)
    expect(
      (await cDirectora.from('recibos').select('id').eq('id', id).maybeSingle()).data?.id
    ).toBe(id)
    const { data: mandatos } = await serviceClient
      .from('mandatos_sepa')
      .select('familia_id')
      .eq('centro_id', centro.id)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect((mandatos ?? []).map((m) => m.familia_id)).toEqual([familiaCon])
  })

  it('registrar: la fecha del banco y los gastos, sin tocar el total ni el envío; sin gastos no', async () => {
    const id = await enviado(familiaSin)
    expect((await devolver(id, null)).error?.code).toBe('23514')
    expect((await devolver(id, 0, '2026-01-04')).error?.code).toBe('23514') // antes del envío
    expect((await devolver(id, -1)).error?.code).toBe('23514')
    expect((await devolver(id, 350)).error).toBeNull()
    expect(await fila(id)).toMatchObject({
      estado: 'devuelto',
      total_centimos: 10000,
      fecha_envio_banco: ENVIO,
      fecha_devolucion: DEVOLUCION,
      devolucion_gastos_centimos: 350,
      devolucion_salida: null,
    })
  })

  it('banco: un re-giro SEPA por total + gastos, con su línea de gastos, que entra en la remesa', async () => {
    const id = await devuelto(familiaCon, 350, { mes: 2 })
    const { data, error } = await resolver(cDirectora, id, 'banco')
    expect(error).toBeNull()
    expect(await regirosDe(id)).toEqual([
      {
        id: data,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10350,
        anio: 2026,
        mes: 2,
        familia_id: familiaCon,
      },
    ])
    const { data: lineas } = await serviceClient
      .from('lineas_recibo')
      .select('descripcion, importe_centimos')
      .eq('recibo_id', data!)
      .order('importe_centimos', { ascending: false })
    expect(lineas).toEqual([
      { descripcion: 'Re-giro de recibo devuelto', importe_centimos: 10000 },
      { descripcion: 'Gastos de devolución', importe_centimos: 350 },
    ])
    expect(await fila(id)).toMatchObject({ estado: 'devuelto', devolucion_salida: 'banco' })
    // Lo que pide la remesa (getRecibosSepaRemesables): SEPA, pendiente, vivo, total > 0, del mes.
    const { data: remesable } = await cDirectora
      .from('recibos')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', 2026)
      .eq('mes', 2)
      .eq('metodo', 'sepa')
      .eq('estado', 'pendiente_procesar')
      .is('deleted_at', null)
      .gt('total_centimos', 0)
    expect((remesable ?? []).map((r) => r.id)).toEqual([data])
  })

  it('efectivo: queda cobrado con su forma y su fecha, y conserva el envío y la devolución', async () => {
    const id = await devuelto(familiaSin, 0)
    const { data, error } = await resolver(cDirectora, id, 'efectivo', COBRO)
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await fila(id)).toMatchObject({
      estado: 'cobrado_manual',
      cobro_forma: 'efectivo',
      cobro_fecha: COBRO,
      fecha_envio_banco: ENVIO,
      fecha_devolucion: DEVOLUCION,
      devolucion_salida: 'efectivo',
    })
    expect(await regirosDe(id)).toEqual([])
  })

  it('UNA sola salida: después del banco, ni otra vez el banco ni efectivo', async () => {
    const id = await devuelto(familiaCon, 350, { mes: 3 })
    expect((await resolver(cDirectora, id, 'banco')).error).toBeNull()
    for (const [salida, fecha] of [
      ['banco', null],
      ['efectivo', COBRO],
      ['transferencia', COBRO],
    ] as const) {
      const { error } = await resolver(cDirectora, id, salida, fecha)
      expect(error?.code).toBe('P0001')
      expect(error?.hint).toBe('devolucion_ya_resuelta')
    }
    expect(await regirosDe(id)).toHaveLength(1)
    expect((await fila(id))?.estado).toBe('devuelto')

    // Y después de efectivo, tampoco el banco.
    const otro = await devuelto(familiaCon, 0, { mes: 3 })
    await resolver(cDirectora, otro, 'efectivo', COBRO)
    expect((await resolver(cDirectora, otro, 'banco')).error?.hint).toBe('devolucion_ya_resuelta')
    expect(await regirosDe(otro)).toEqual([])
  })

  it('si llegan dos salidas a la vez, solo entra una', async () => {
    const id = await devuelto(familiaCon, 350, { mes: 4 })
    const [a, b] = await Promise.all([
      resolver(cDirectora, id, 'banco'),
      resolver(cDirectora, id, 'efectivo', COBRO),
    ])
    expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1)
    expect([a.error?.hint, b.error?.hint].filter(Boolean)).toEqual(['devolucion_ya_resuelta'])
    const f = await fila(id)
    const regiros = await regirosDe(id)
    // O un re-giro y el original devuelto, o cobrado en efectivo y sin re-giro: nunca las dos.
    if (f?.devolucion_salida === 'banco') {
      expect(f.estado).toBe('devuelto')
      expect(regiros).toHaveLength(1)
    } else {
      expect(f).toMatchObject({ estado: 'cobrado_manual', devolucion_salida: 'efectivo' })
      expect(regiros).toEqual([])
    }
  })

  it('por otro camino que no sea la función, la devolución no se resuelve (la directora y service_role)', async () => {
    const id = await devuelto(familiaCon, 350, { mes: 5 })
    for (const cliente of [cDirectora, serviceClient]) {
      // Cobrarla a mano (el «Marcar cobrado» del PR-1a).
      const cobro = await cliente
        .from('recibos')
        .update({ estado: 'cobrado_manual', cobro_forma: 'efectivo', cobro_fecha: COBRO })
        .eq('id', id)
      expect(cobro.error?.hint).toBe('devolucion_por_funcion')
      // Crear un re-giro a mano.
      const regiro = await cliente.from('recibos').insert({
        centro_id: centro.id,
        familia_id: familiaCon,
        anio: 2026,
        mes: 5,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 10000,
        devuelto_de_recibo_id: id,
      })
      expect(regiro.error?.hint).toBe('devolucion_por_funcion')
      // Poner la salida.
      const salida = await cliente
        .from('recibos')
        .update({ devolucion_salida: 'banco' })
        .eq('id', id)
      expect(salida.error?.hint).toBe('devolucion_por_funcion')
    }
    // Ni con cheque.
    const cheque = await cDirectora.rpc('cobrar_recibo_con_cheque', {
      p_recibo_id: id,
      p_importe_centimos: 10000,
      p_fecha: COBRO,
      p_nota: null as unknown as string,
      p_metodo_diferencia: null as unknown as string,
    })
    expect(cheque.error?.hint).toBe('devolucion_por_funcion')
    expect(await fila(id)).toMatchObject({ estado: 'devuelto', devolucion_salida: null })
    expect(await regirosDe(id)).toEqual([])
  })

  it('una devolución resuelta no cambia: ni sus gastos ni su fecha', async () => {
    const id = await devuelto(familiaCon, 350, { mes: 6 })
    await resolver(cDirectora, id, 'banco')
    const gastos = await cDirectora
      .from('recibos')
      .update({ devolucion_gastos_centimos: 0 })
      .eq('id', id)
    expect(gastos.error?.hint).toBe('devolucion_ya_resuelta')
    const fecha = await cDirectora.from('recibos').update({ fecha_devolucion: ENVIO }).eq('id', id)
    expect(fecha.error?.hint).toBe('devolucion_ya_resuelta')
  })

  it('banco sin mandato activo: no escribe nada', async () => {
    const id = await devuelto(familiaSin)
    const { error } = await resolver(cDirectora, id, 'banco')
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('sin_mandato')
    expect(await fila(id)).toMatchObject({ estado: 'devuelto', devolucion_salida: null })
    expect(await regirosDe(id)).toEqual([])
  })

  it('el cobro no puede ser anterior a la devolución, ni sin fecha', async () => {
    const id = await devuelto(familiaSin)
    expect((await resolver(cDirectora, id, 'transferencia', '2026-01-19')).error?.hint).toBe(
      'fecha_cobro_invalida'
    )
    expect((await resolver(cDirectora, id, 'transferencia', null)).error?.hint).toBe(
      'fecha_cobro_invalida'
    )
    expect((await resolver(cDirectora, id, 'transferencia', DEVOLUCION)).error).toBeNull()
  })

  it('un recibo regular de un mes cerrado: se devuelve y vuelve al banco (el re-giro está exento)', async () => {
    const id = await enviado(familiaCon, {
      es_esporadico: false,
      concepto_esporadico: null,
      mes: 7,
    })
    await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centro.id, anio: 2026, mes: 7, cerrado_por: directora.id })
    expect((await devolver(id, 200)).error).toBeNull()
    const { data, error } = await resolver(cDirectora, id, 'banco')
    expect(error).toBeNull()
    expect((await regirosDe(id)).map((r) => [r.id, r.total_centimos])).toEqual([[data, 10200]])
  })

  it('la tutora no resuelve devoluciones', async () => {
    const id = await devuelto(familiaSin)
    const { error } = await resolver(cTutora, id, 'efectivo', COBRO)
    expect(['P0002', '42501']).toContain(error?.code)
    expect((await fila(id))?.devolucion_salida).toBeNull()
  })

  it('audit_log: la salida con sus gastos y su actor, sin la nota; el re-giro, con su actor', async () => {
    const efectivo = await devuelto(familiaSin, 200, { mes: 8 })
    await resolver(cDirectora, efectivo, 'efectivo', COBRO, 'Nota de la devolución')
    const banco = await devuelto(familiaCon, 350, { mes: 8 })
    const { data: regiro } = await resolver(cDirectora, banco, 'banco')
    const { data } = await serviceClient
      .from('audit_log')
      .select('registro_id, usuario_id, accion, valores_despues')
      .eq('tabla', 'recibos')
      .in('registro_id', [efectivo, banco, regiro!])
    const con = (id: string, salida: string) =>
      (data ?? []).find(
        (a) =>
          a.registro_id === id &&
          (a.valores_despues as Record<string, unknown> | null)?.devolucion_salida === salida
      )
    const cobro = con(efectivo, 'efectivo')
    expect(cobro?.usuario_id).toBe(directora.id)
    expect(cobro!.valores_despues).toMatchObject({ devolucion_gastos_centimos: 200 })
    expect(cobro!.valores_despues).not.toHaveProperty('cobro_nota')
    expect(JSON.stringify(data)).not.toContain('Nota de la devolución')
    expect(con(banco, 'banco')?.usuario_id).toBe(directora.id)
    const alta = (data ?? []).find((a) => a.registro_id === regiro && a.accion === 'INSERT')
    expect(alta?.usuario_id).toBe(directora.id)
  })

  it('export del art. 15: la tutora recibe los gastos y la salida de su devolución', async () => {
    const id = await devuelto(familiaSin, 275, {
      mes: 9,
      concepto_esporadico: 'Export PR-2',
    })
    await resolver(cDirectora, id, 'transferencia', COBRO)
    const { data, error } = await cTutora.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutora.id,
    })
    expect(error).toBeNull()
    const recibos = (
      (data as { cobros_familia: { recibos: Record<string, unknown>[] }[] }).cobros_familia ?? []
    ).flatMap((f) => f.recibos)
    expect(recibos.find((r) => r.concepto_esporadico === 'Export PR-2')).toMatchObject({
      devolucion_gastos_centimos: 275,
      devolucion_salida: 'transferencia',
    })
  })
})
