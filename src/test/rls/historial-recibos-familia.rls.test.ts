import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-6 — el histórico de recibos de una familia, contra la BD real y con la sesión de Dirección.
 *
 * Cada estado lo dejan las funciones de cobro de verdad (`resolver_devolucion` con sus salidas,
 * `cobrar_recibo_con_cheque`, `resolver_sobrante_cheque`, el enlace a una remesa), no un INSERT con
 * la forma que el test cree que tienen: el histórico tiene que leer lo que esas funciones escriben.
 * Y solo salen los recibos de esa familia y de ese centro.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getHistorialRecibosFamilia } =
  await import('@/features/recibos/queries/get-historial-recibos-familia')
const { getReciboAdminDetalle } =
  await import('@/features/recibos/queries/get-recibo-admin-detalle')

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ANIO = 2026

describe('F-6 — histórico de recibos de la familia', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let otraFamilia: string
  let directora: TestUser
  let directoraOtro: TestUser
  let tutora: TestUser
  let cDirectora: SupabaseClient<Database>
  let cDirectoraOtro: SupabaseClient<Database>

  const r = {} as Record<
    | 'borrador'
    | 'enRemesa'
    | 'devBanco'
    | 'devSiguiente'
    | 'devEfectivo'
    | 'chequeMenor'
    | 'chequeMayor'
    | 'deOtraFamilia',
    string
  >

  async function recibo(familiaId: string, over: Partial<Recibo>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        anio: ANIO,
        mes: 1,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 11000,
        es_esporadico: false,
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  /** Enviado al banco y devuelto por Dirección, como en la app. */
  async function devuelto(mes: number, gastos: number): Promise<string> {
    const mm = String(mes).padStart(2, '0')
    const id = await recibo(familia, {
      mes,
      estado: 'enviado_banco',
      fecha_envio_banco: `${ANIO}-${mm}-05`,
    })
    const { error } = await cDirectora
      .from('recibos')
      .update({
        estado: 'devuelto',
        fecha_devolucion: `${ANIO}-${mm}-20`,
        devolucion_gastos_centimos: gastos,
      })
      .eq('id', id)
      .select('id')
      .single()
    if (error) throw new Error(`devolver: ${error.message}`)
    return id
  }

  async function ok<T extends { error: { message: string } | null }>(
    p: PromiseLike<T>,
    que: string
  ) {
    const res = await p
    if (res.error) throw new Error(`${que}: ${res.error.message}`)
    return res
  }

  async function regularDe(mes: number): Promise<string> {
    const { data } = await serviceClient
      .from('recibos')
      .select('id')
      .eq('familia_id', familia)
      .eq('anio', ANIO)
      .eq('mes', mes)
      .eq('es_esporadico', false)
      .is('devuelto_de_recibo_id', null)
      .is('deleted_at', null)
      .single()
    return data!.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Historial F6')
    otroCentro = await createTestCentro('Otro Centro Historial F6')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    const nino = await createTestNino(centro.id, 'Nino Historial F6')
    familia = nino.familia_id
    // Con hijo activo: diferir el sobrante de un cheque lo exige.
    await matricular(nino.id, aula.id, curso.id)
    otraFamilia = (await createTestNino(centro.id, 'Nino Otra Familia F6')).familia_id

    // La familia firma su mandato SEPA (camino real del alta): volver a pasar al banco lo exige.
    tutora = await createTestUser({ nombre: 'Tutora Historial F6' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutora.id)
    const cTutora = await clientFor(tutora)
    await ok(
      cTutora.rpc('registrar_mandato_sepa', {
        p_familia_id: familia,
        p_nino_id: nino.id,
        p_iban: 'ES7620770024003102575766',
        p_titular: 'Tutora Historial F6',
        p_identificador_mandato: 'NIDO-F6-1',
        p_documento_path: '',
        p_firma_imagen: '',
        p_nombre_tecleado: 'Tutora Historial F6',
        p_texto_hash: 'c'.repeat(64),
        p_ip_address: null,
        p_user_agent: 'test',
        p_fecha_firma: '2026-01-01T10:00:00Z',
      } as never),
      'mandato'
    )

    directora = await createTestUser({ nombre: 'Directora Historial F6' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
    directoraOtro = await createTestUser({ nombre: 'Directora Otro Centro F6' })
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    cDirectoraOtro = await clientFor(directoraOtro)

    // Enero: un borrador.
    r.borrador = await recibo(familia, { mes: 1, estado: 'borrador' })

    // Febrero: validado y en una remesa en borrador.
    r.enRemesa = await recibo(familia, { mes: 2 })
    const { data: remesa } = await ok(
      cDirectora
        .from('remesas')
        .insert({ centro_id: centro.id, anio: ANIO, mes: 2 })
        .select('id')
        .single(),
      'remesa'
    )
    await ok(
      cDirectora
        .from('recibos_remesa')
        .insert({ centro_id: centro.id, remesa_id: remesa!.id, recibo_id: r.enRemesa }),
      'enlace'
    )

    // Marzo: devuelto y vuelto a pasar al banco (re-giro).
    r.devBanco = await devuelto(3, 300)
    await ok(
      cDirectora.rpc('resolver_devolucion', {
        p_recibo_id: r.devBanco,
        p_salida: 'banco',
        p_fecha: null as unknown as string,
        p_nota: null as unknown as string,
      }),
      'resolver banco'
    )

    // Abril: devuelto y llevado al recibo de mayo, que la función crea.
    r.devSiguiente = await devuelto(4, 200)
    await ok(
      cDirectora.rpc('resolver_devolucion', {
        p_recibo_id: r.devSiguiente,
        p_salida: 'siguiente_recibo',
        p_fecha: null as unknown as string,
        p_nota: null as unknown as string,
      }),
      'resolver siguiente'
    )

    // Junio: devuelto y cobrado en efectivo.
    r.devEfectivo = await devuelto(6, 0)
    await ok(
      cDirectora.rpc('resolver_devolucion', {
        p_recibo_id: r.devEfectivo,
        p_salida: 'efectivo',
        p_fecha: `${ANIO}-06-25`,
        p_nota: null as unknown as string,
      }),
      'resolver efectivo'
    )

    // Julio: cheque menor que el recibo; la diferencia, en efectivo, en un esporádico aparte.
    r.chequeMenor = await recibo(familia, { mes: 7, metodo: 'cheque_guarderia' })
    await ok(
      cDirectora.rpc('cobrar_recibo_con_cheque', {
        p_recibo_id: r.chequeMenor,
        p_importe_centimos: 8000,
        p_fecha: `${ANIO}-07-10`,
        p_nota: null as unknown as string,
        p_metodo_diferencia: 'efectivo',
      }),
      'cheque menor'
    )

    // Agosto: cheque mayor; el sobrante, diferido al recibo de septiembre.
    r.chequeMayor = await recibo(familia, { mes: 8, metodo: 'cheque_guarderia' })
    await ok(
      cDirectora.rpc('cobrar_recibo_con_cheque', {
        p_recibo_id: r.chequeMayor,
        p_importe_centimos: 12000,
        p_fecha: `${ANIO}-08-10`,
        p_nota: null as unknown as string,
        p_metodo_diferencia: null as unknown as string,
      }),
      'cheque mayor'
    )
    await ok(
      cDirectora.rpc('resolver_sobrante_cheque', { p_recibo_id: r.chequeMayor, p_via: 'diferir' }),
      'diferir sobrante'
    )

    // Otra familia del mismo centro: no puede salir.
    r.deOtraFamilia = await recibo(otraFamilia, { mes: 3 })
  }, 180_000)

  afterAll(async () => {
    sesion.actual = null
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      // El re-giro y la diferencia del cheque apuntan a su original (RESTRICT): primero ellos.
      await serviceClient
        .from('recibos')
        .delete()
        .eq('centro_id', c.id)
        .or('devuelto_de_recibo_id.not.is.null,diferencia_de_recibo_id.not.is.null')
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('mandatos_sepa').delete().eq('centro_id', c.id)
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [directora, directoraOtro, tutora]) await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: las funciones de cobro dejaron cada recibo en su estado', async () => {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, estado, devolucion_salida, cobro_importe_centimos')
      .in('id', Object.values(r))
    const por = new Map((data ?? []).map((x) => [x.id, x]))
    expect(por.get(r.devBanco)).toMatchObject({ estado: 'devuelto', devolucion_salida: 'banco' })
    expect(por.get(r.devSiguiente)).toMatchObject({
      estado: 'devuelto',
      devolucion_salida: 'siguiente_recibo',
    })
    expect(por.get(r.devEfectivo)).toMatchObject({
      estado: 'cobrado_manual',
      devolucion_salida: 'efectivo',
    })
    expect(por.get(r.chequeMenor)).toMatchObject({
      estado: 'cobrado_manual',
      cobro_importe_centimos: 8000,
    })
    expect(por.get(r.chequeMayor)).toMatchObject({
      estado: 'cobrado_manual',
      cobro_importe_centimos: 12000,
    })
  })

  it('Dirección ve todos los recibos de la familia, con su estado y lo que pasó en cada uno', async () => {
    sesion.actual = cDirectora
    const h = await getHistorialRecibosFamilia(familia, centro.id)
    expect(h.ok).toBe(true)
    if (!h.ok) return
    const f = (id: string) => h.recibos.find((x) => x.id === id)!

    const mayo = await regularDe(5)
    const septiembre = await regularDe(9)
    const regiro = h.recibos.find((x) => x.tipo === 'regiro')
    const diferencia = h.recibos.find((x) => x.tipo === 'diferencia_cheque')
    // Los siete de la familia, más los cuatro que crearon las funciones; ninguno de otra familia.
    expect(h.recibos).toHaveLength(11)
    expect(h.recibos.map((x) => x.id)).not.toContain(r.deOtraFamilia)

    expect(f(r.borrador).estado).toBe('borrador')
    expect(f(r.enRemesa)).toMatchObject({
      estado: 'en_remesa',
      remesa: { anio: ANIO, mes: 2, enviada: false },
    })

    // Banco: sigue devuelto, enlaza su re-giro (recibo + gastos) y el re-giro, su origen.
    expect(f(r.devBanco)).toMatchObject({
      estado: 'devuelto',
      devolucion: { salida: 'banco', importeCentimos: 11300, llevadaA: { reciboId: regiro!.id } },
    })
    expect(regiro).toMatchObject({ totalCentimos: 11300, origen: { reciboId: r.devBanco } })

    // Siguiente recibo: enlaza el de mayo, que dice qué incluye.
    expect(f(r.devSiguiente)).toMatchObject({
      estado: 'devuelto',
      devolucion: { salida: 'siguiente_recibo', llevadaA: { reciboId: mayo, mes: 5 } },
    })
    expect(f(mayo)).toMatchObject({
      estado: 'borrador',
      incluye: [{ reciboId: r.devSiguiente, tipo: 'devolucion', importeCentimos: 11200 }],
    })

    // Efectivo: cobrado, sin perder que fue una devolución.
    expect(f(r.devEfectivo)).toMatchObject({
      estado: 'cobrado',
      cobro: { forma: 'efectivo', fecha: `${ANIO}-06-25` },
      devolucion: { salida: 'efectivo' },
    })

    // Cheque menor: el cheque y la diferencia enlazada en los dos sentidos.
    expect(f(r.chequeMenor)).toMatchObject({
      estado: 'cobrado',
      cobro: { forma: 'cheque_guarderia', chequeCentimos: 8000 },
      diferencia: { reciboId: diferencia!.id, totalCentimos: 3000 },
    })
    expect(diferencia).toMatchObject({ metodo: 'efectivo', origen: { reciboId: r.chequeMenor } })

    // Cheque mayor: el sobrante diferido al recibo de septiembre, que lo descuenta.
    expect(f(r.chequeMayor).sobrante).toEqual({
      excesoCentimos: 1000,
      resueltoPor: 'diferir',
      diferidoA: { reciboId: septiembre, anio: ANIO, mes: 9 },
    })
    expect(f(septiembre).incluye).toEqual([
      { reciboId: r.chequeMayor, anio: ANIO, mes: 8, tipo: 'sobrante', importeCentimos: -1000 },
    ])
  })

  it('el detalle abre un recibo de la familia con su desglose; el de otra familia, no', async () => {
    sesion.actual = cDirectora
    const mayo = await regularDe(5)
    const d = await getReciboAdminDetalle(mayo, familia, centro.id)
    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.recibo.id).toBe(mayo)
    // La línea de la devolución arrastrada es de la familia (sin niño), por recibo + gastos.
    expect(d.desglose.lineasFamiliares.map((l) => l.importeCentimos)).toEqual([11200])

    expect(await getReciboAdminDetalle(r.deOtraFamilia, familia, centro.id)).toEqual({
      ok: false,
      motivo: 'no_encontrado',
    })
  })

  it('la Dirección de otro centro no ve nada de esta familia', async () => {
    sesion.actual = cDirectoraOtro
    // Con su propio centro, la familia no es de él; con el de la familia, la RLS no le deja.
    expect(await getHistorialRecibosFamilia(familia, otroCentro.id)).toEqual({
      ok: true,
      recibos: [],
    })
    expect(await getHistorialRecibosFamilia(familia, centro.id)).toEqual({ ok: true, recibos: [] })
    expect(await getReciboAdminDetalle(r.borrador, familia, centro.id)).toEqual({
      ok: false,
      motivo: 'no_encontrado',
    })
  })
})
