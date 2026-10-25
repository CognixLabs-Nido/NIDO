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
 * PR-1b (`20261106120000`) — cobrar con cheque guardería / ticket restaurant.
 *
 *  - La directora introduce el importe del cheque (`cobrar_recibo_con_cheque`). Si cubre el recibo,
 *    queda cobrado. Si es menor, la diferencia va a un recibo esporádico aparte, del mismo periodo,
 *    por SEPA (solo con mandato activo), efectivo o transferencia, y sigue su circuito.
 *  - Un cheque mayor que el recibo deja el recibo cobrado y el sobrante pendiente (PR-1c, lo
 *    detalla `cheque-sobrante.rls.test.ts`).
 *  - Las dos escrituras van juntas: si algo falla, no queda nada escrito.
 *  - Por otro camino que no sea la función, el cheque no entra (trigger de la transición), tampoco
 *    con service_role: no puede quedar un cheque menor sin el recibo de su diferencia.
 *  - Lo cobra Dirección; el actor de audit_log es quien cobra, sin la nota; el export del art. 15
 *    lleva el importe del cheque.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const FECHA = '2026-01-20'

describe('PR-1b — cobro con cheque guardería / ticket restaurant', () => {
  let centro: { id: string }
  let familiaSin: string
  let familiaCon: string
  let directora: TestUser
  let tutora: TestUser
  let tutoraCon: TestUser
  let cDirectora: SupabaseClient<Database>
  let cTutora: SupabaseClient<Database>

  async function recibo(familia: string, over: Partial<Recibo> = {}): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 1,
        estado: 'pendiente_procesar',
        metodo: 'cheque_guarderia',
        total_centimos: 11000,
        es_esporadico: true,
        concepto_esporadico: 'Cobro con cheque PR-1b',
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  function cheque(
    cliente: SupabaseClient<Database>,
    reciboId: string,
    importe: number,
    metodo: string | null = null,
    nota: string | null = null
  ) {
    return cliente.rpc('cobrar_recibo_con_cheque', {
      p_recibo_id: reciboId,
      p_importe_centimos: importe,
      p_fecha: FECHA,
      p_nota: nota as string,
      p_metodo_diferencia: metodo as string,
    })
  }

  async function fila(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select('estado, cobro_forma, cobro_importe_centimos, cobro_fecha')
      .eq('id', id)
      .single()
    return data
  }

  async function diferenciasDe(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, estado, metodo, total_centimos, es_esporadico, anio, mes, familia_id')
      .eq('diferencia_de_recibo_id', id)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cobro Cheque')
    const ninoSin = await createTestNino(centro.id, 'Nino Cheque Sin Mandato')
    const ninoCon = await createTestNino(centro.id, 'Nino Cheque Con Mandato')
    familiaSin = ninoSin.familia_id
    familiaCon = ninoCon.familia_id

    directora = await createTestUser({ nombre: 'Directora Cobro Cheque' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)

    tutora = await createTestUser({ nombre: 'Tutora Cobro Cheque' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaSin, tutora.id)
    cTutora = await clientFor(tutora)

    // La otra familia firma su mandato SEPA (camino real del alta).
    tutoraCon = await createTestUser({ nombre: 'Tutora Cheque Con Mandato' })
    await asignarRol(tutoraCon.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaCon, tutoraCon.id)
    const cTutoraCon = await clientFor(tutoraCon)
    const { error } = await cTutoraCon.rpc('registrar_mandato_sepa', {
      p_familia_id: familiaCon,
      p_nino_id: ninoCon.id,
      p_iban: 'ES7620770024003102575766',
      p_titular: 'Tutora Cheque Con Mandato',
      p_identificador_mandato: 'NIDO-PR1B-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Tutora Cheque Con Mandato',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-01-01T10:00:00Z',
    } as never)
    if (error) throw new Error(`mandato: ${error.message}`)
  }, 60_000)

  afterAll(async () => {
    await serviceClient
      .from('recibos')
      .delete()
      .eq('centro_id', centro.id)
      .not('diferencia_de_recibo_id', 'is', null)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await deleteTestUser(directora.id)
    await deleteTestUser(tutora.id)
    await deleteTestUser(tutoraCon.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('premisa: la directora lee el recibo, y solo una de las dos familias tiene mandato activo', async () => {
    const id = await recibo(familiaSin)
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

  it('cheque igual al recibo: queda cobrado con su importe y sin recibo de diferencia', async () => {
    const id = await recibo(familiaSin)
    const { data, error } = await cheque(cDirectora, id, 11000, 'efectivo')
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await fila(id)).toEqual({
      estado: 'cobrado_manual',
      cobro_forma: 'cheque_guarderia',
      cobro_importe_centimos: 11000,
      cobro_fecha: FECHA,
    })
    expect(await diferenciasDe(id)).toEqual([])
  })

  it('cheque menor + efectivo: la diferencia va a un esporádico pendiente del mismo periodo, que se cobra por el PR-1a', async () => {
    const id = await recibo(familiaSin, { mes: 2 })
    const { data, error } = await cheque(cDirectora, id, 10000, 'efectivo')
    expect(error).toBeNull()
    expect((await fila(id))?.cobro_importe_centimos).toBe(10000)
    const difs = await diferenciasDe(id)
    expect(difs).toEqual([
      {
        id: data,
        estado: 'pendiente_procesar',
        metodo: 'efectivo',
        total_centimos: 1000,
        es_esporadico: true,
        anio: 2026,
        mes: 2,
        familia_id: familiaSin,
      },
    ])
    const { error: e2 } = await cDirectora
      .from('recibos')
      .update({ estado: 'cobrado_manual', cobro_forma: 'efectivo', cobro_fecha: FECHA })
      .eq('id', data!)
    expect(e2).toBeNull()
  })

  it('cheque menor + SEPA con mandato: la diferencia es un esporádico SEPA que entra en la remesa', async () => {
    const id = await recibo(familiaCon, { mes: 3 })
    const { data, error } = await cheque(cDirectora, id, 6000, 'sepa')
    expect(error).toBeNull()
    // Lo que pide la remesa (getRecibosSepaRemesables): SEPA, pendiente, vivo, total > 0, del mes.
    const { data: remesable } = await cDirectora
      .from('recibos')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('anio', 2026)
      .eq('mes', 3)
      .eq('metodo', 'sepa')
      .eq('estado', 'pendiente_procesar')
      .is('deleted_at', null)
      .gt('total_centimos', 0)
    expect((remesable ?? []).map((r) => r.id)).toEqual([data])
  })

  it('cheque menor + SEPA sin mandato: no escribe nada', async () => {
    const id = await recibo(familiaSin)
    const { error } = await cheque(cDirectora, id, 10000, 'sepa')
    expect(error?.code).toBe('P0001')
    expect(error?.hint).toBe('sin_mandato')
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
    expect(await diferenciasDe(id)).toEqual([])
  })

  it('cheque menor sin decir cómo se cobra el resto: no escribe nada', async () => {
    const id = await recibo(familiaSin)
    const { error } = await cheque(cDirectora, id, 10000, null)
    expect(error?.hint).toBe('falta_metodo_diferencia')
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
  })

  it('cheque mayor que el recibo: queda cobrado y el sobrante, pendiente (PR-1c)', async () => {
    const id = await recibo(familiaSin)
    const { error } = await cheque(cDirectora, id, 11001, null)
    expect(error).toBeNull()
    expect((await fila(id))?.estado).toBe('cobrado_manual')
    expect(await diferenciasDe(id)).toEqual([])
    const { data: sobrante } = await serviceClient
      .from('beca_comedor_desborde')
      .select('exceso_centimos, estado, origen')
      .eq('recibo_id', id)
      .single()
    expect(sobrante).toEqual({ exceso_centimos: 1, estado: 'pendiente', origen: 'cheque' })
  })

  it('un SEPA pendiente tampoco se cobra con cheque: va por remesa', async () => {
    const id = await recibo(familiaCon, { metodo: 'sepa' })
    const { error } = await cheque(cDirectora, id, 11000, null)
    expect(error?.hint).toBe('sepa_por_remesa')
  })

  it('por otro camino que no sea la función, el cheque no entra (la directora y service_role)', async () => {
    const id = await recibo(familiaSin)
    const directo = {
      estado: 'cobrado_manual' as const,
      cobro_forma: 'cheque_guarderia' as const,
      cobro_fecha: FECHA,
      cobro_importe_centimos: 10000,
    }
    const r1 = await cDirectora.from('recibos').update(directo).eq('id', id)
    expect(r1.error?.code).toBe('P0001')
    expect(r1.error?.hint).toBe('cheque_por_funcion')
    const r2 = await serviceClient.from('recibos').update(directo).eq('id', id)
    expect(r2.error?.hint).toBe('cheque_por_funcion')
    expect((await fila(id))?.estado).toBe('pendiente_procesar')

    // Ni cambiar después el importe de un cheque ya registrado.
    const otro = await recibo(familiaSin)
    await cheque(cDirectora, otro, 11000)
    const r3 = await cDirectora
      .from('recibos')
      .update({ cobro_importe_centimos: 5000 })
      .eq('id', otro)
    expect(r3.error?.hint).toBe('cheque_por_funcion')
  })

  it('la tutora no cobra con cheque', async () => {
    const id = await recibo(familiaSin)
    const { error } = await cheque(cTutora, id, 11000)
    expect(['P0002', '42501']).toContain(error?.code)
    expect((await fila(id))?.estado).toBe('pendiente_procesar')
  })

  it('audit_log: el cobro con su importe y su actor, sin la nota; la diferencia, con su actor', async () => {
    const id = await recibo(familiaSin, { mes: 4 })
    const { data: dif } = await cheque(cDirectora, id, 10000, 'transferencia', 'Nota del cheque')
    const { data } = await serviceClient
      .from('audit_log')
      .select('registro_id, usuario_id, valores_despues')
      .eq('tabla', 'recibos')
      .in('registro_id', [id, dif!])
    const cobro = (data ?? []).find(
      (a) =>
        a.registro_id === id &&
        (a.valores_despues as Record<string, unknown> | null)?.estado === 'cobrado_manual'
    )
    expect(cobro?.usuario_id).toBe(directora.id)
    const despues = cobro!.valores_despues as Record<string, unknown>
    expect(despues.cobro_importe_centimos).toBe(10000)
    expect(despues).not.toHaveProperty('cobro_nota')
    expect(JSON.stringify(data)).not.toContain('Nota del cheque')
    const diferencia = (data ?? []).filter((a) => a.registro_id === dif)
    expect(diferencia.length).toBeGreaterThan(0)
    expect(diferencia.every((a) => a.usuario_id === directora.id)).toBe(true)
  })

  it('export del art. 15: la tutora recibe el importe del cheque', async () => {
    const id = await recibo(familiaSin, { mes: 5, concepto_esporadico: 'Export PR-1b' })
    await cheque(cDirectora, id, 11000)
    const { data, error } = await cTutora.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutora.id,
    })
    expect(error).toBeNull()
    const recibos = (
      (data as { cobros_familia: { recibos: Record<string, unknown>[] }[] }).cobros_familia ?? []
    ).flatMap((f) => f.recibos)
    expect(recibos.find((r) => r.concepto_esporadico === 'Export PR-1b')).toMatchObject({
      cobro_forma: 'cheque_guarderia',
      cobro_importe_centimos: 11000,
    })
  })
})
