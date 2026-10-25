import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FiltroHistorial } from '@/features/recibos/lib/filtro-historial'
import type { Database } from '@/types/database'

/**
 * F-6 — el histórico general de recibos del centro, contra la BD real y con la sesión de Dirección.
 *
 *  - Pagina en la BD, de 50 en 50, del más reciente al más antiguo; una página que no existe sirve
 *    la última. Cuenta los borradores y deja fuera los borrados y los de otro centro.
 *  - Filtra por año y mes, por familia y por niño (los recibos con una línea suya y los esporádicos
 *    cargados a él; no los de su hermano).
 *  - Los enlaces de un recibo apuntan también a recibos que el filtro deja fuera: la devolución
 *    llevada al mes siguiente y el sobrante diferido, creados por sus funciones de verdad.
 *  - La Dirección de otro centro no ve nada, ni en la lista ni en los filtros.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { getHistorialRecibosGeneral, RECIBOS_POR_PAGINA } =
  await import('@/features/recibos/queries/get-historial-recibos-general')
const { getOpcionesHistorial } = await import('@/features/recibos/queries/get-opciones-historial')

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ANIO = 2026
const SIN_FILTRO: FiltroHistorial = {
  anio: null,
  mes: null,
  familiaId: null,
  ninoId: null,
  pagina: 1,
}
const filtro = (over: Partial<FiltroHistorial>): FiltroHistorial => ({ ...SIN_FILTRO, ...over })

describe('F-6 — histórico general de recibos', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let otraFamilia: string
  let nino: string
  let hermano: string
  let ninoOtraFamilia: string
  let directora: TestUser
  let directoraOtro: TestUser
  let cDirectora: SupabaseClient<Database>
  let cDirectoraOtro: SupabaseClient<Database>
  const r = {} as Record<
    | 'eneroBorrador'
    | 'eneroEsporadico'
    | 'febreroHermano'
    | 'abrilDevuelto'
    | 'agostoCheque'
    | 'borrado',
    string
  >

  async function recibo(over: Partial<Recibo>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
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

  async function linea(reciboId: string, ninoId: string) {
    const { error } = await serviceClient.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      nino_id: ninoId,
      descripcion: 'Escolaridad F6',
      cantidad: 1,
      precio_unitario_centimos: 11000,
      importe_centimos: 11000,
    })
    if (error) throw new Error(`línea: ${error.message}`)
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

  async function historial(f: FiltroHistorial) {
    const h = await getHistorialRecibosGeneral(centro.id, f)
    if (!h.ok) throw new Error('test: la lectura falló')
    return h
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Historial General F6')
    otroCentro = await createTestCentro('Otro Centro Historial General F6')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    const n = await createTestNino(centro.id, 'Nino Historial General F6')
    nino = n.id
    familia = n.familia_id
    // Con hijo activo: diferir el sobrante del cheque lo exige.
    await matricular(nino, aula.id, curso.id)
    const { data: h, error: errH } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Hermano Historial General F6',
        apellidos: 'Apellido Test',
        fecha_nacimiento: '2024-03-01',
      })
      .select('id')
      .single()
    if (errH || !h) throw new Error(`hermano: ${errH?.message}`)
    hermano = h.id
    const otro = await createTestNino(centro.id, 'Nino Otra Familia General F6')
    ninoOtraFamilia = otro.id
    otraFamilia = otro.familia_id

    directora = await createTestUser({ nombre: 'Directora Historial General F6' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
    directoraOtro = await createTestUser({ nombre: 'Directora Otro Centro General F6' })
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    cDirectoraOtro = await clientFor(directoraOtro)

    // La otra familia: 52 esporádicos de 2025, para que haya más de una página.
    await ok(
      serviceClient.from('recibos').insert(
        Array.from({ length: 52 }, (_, i) => ({
          centro_id: centro.id,
          familia_id: otraFamilia,
          anio: 2025,
          mes: (i % 12) + 1,
          estado: 'pendiente_procesar' as const,
          metodo: 'efectivo' as const,
          total_centimos: 1000,
          es_esporadico: true,
          concepto_esporadico: 'Material F6',
        }))
      ),
      'esporádicos'
    )

    // Enero: un borrador con una línea del niño, y un esporádico cargado al niño sin líneas.
    r.eneroBorrador = await recibo({ estado: 'borrador' })
    await linea(r.eneroBorrador, nino)
    r.eneroEsporadico = await recibo({
      es_esporadico: true,
      nino_id: nino,
      concepto_esporadico: 'Excursión F6',
      total_centimos: 1500,
    })

    // Febrero: solo con una línea del hermano (se valida después de escribirla).
    r.febreroHermano = await recibo({ mes: 2, estado: 'borrador' })
    await linea(r.febreroHermano, hermano)
    await ok(
      serviceClient
        .from('recibos')
        .update({ estado: 'pendiente_procesar' })
        .eq('id', r.febreroHermano),
      'validar febrero'
    )

    // Marzo: uno borrado, que no sale.
    r.borrado = await recibo({ mes: 3, estado: 'borrador', deleted_at: new Date().toISOString() })

    // Abril: devuelto y llevado al recibo de mayo, que crea la función.
    r.abrilDevuelto = await recibo({
      mes: 4,
      estado: 'enviado_banco',
      fecha_envio_banco: `${ANIO}-04-05`,
    })
    await ok(
      cDirectora
        .from('recibos')
        .update({
          estado: 'devuelto',
          fecha_devolucion: `${ANIO}-04-20`,
          devolucion_gastos_centimos: 200,
        })
        .eq('id', r.abrilDevuelto)
        .select('id')
        .single(),
      'devolver'
    )
    await ok(
      cDirectora.rpc('resolver_devolucion', {
        p_recibo_id: r.abrilDevuelto,
        p_salida: 'siguiente_recibo',
        p_fecha: null as unknown as string,
        p_nota: null as unknown as string,
      }),
      'resolver siguiente'
    )

    // Agosto: cheque mayor; el sobrante, diferido al recibo de septiembre que crea la función.
    r.agostoCheque = await recibo({ mes: 8, metodo: 'cheque_guarderia' })
    await ok(
      cDirectora.rpc('cobrar_recibo_con_cheque', {
        p_recibo_id: r.agostoCheque,
        p_importe_centimos: 12000,
        p_fecha: `${ANIO}-08-10`,
        p_nota: null as unknown as string,
        p_metodo_diferencia: null as unknown as string,
      }),
      'cheque'
    )
    await ok(
      cDirectora.rpc('resolver_sobrante_cheque', { p_recibo_id: r.agostoCheque, p_via: 'diferir' }),
      'diferir'
    )

    // Otro centro: un recibo que no puede salir.
    const ninoOtroCentro = await createTestNino(otroCentro.id, 'Nino Otro Centro General F6')
    await ok(
      serviceClient.from('recibos').insert({
        centro_id: otroCentro.id,
        familia_id: ninoOtroCentro.familia_id,
        anio: ANIO,
        mes: 1,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 9900,
        es_esporadico: false,
      }),
      'recibo otro centro'
    )
  }, 180_000)

  afterAll(async () => {
    sesion.actual = null
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_transferencia').delete().eq('centro_id', c.id)
      await serviceClient.from('beca_comedor_desborde').delete().eq('centro_id', c.id)
      await serviceClient
        .from('recibos')
        .delete()
        .eq('centro_id', c.id)
        .or('devuelto_de_recibo_id.not.is.null,diferencia_de_recibo_id.not.is.null')
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('cierre_mensual').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [directora, directoraOtro]) await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: las funciones de cobro dejaron la devolución llevada y el sobrante diferido', async () => {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, estado, devolucion_salida')
      .in('id', [r.abrilDevuelto, r.agostoCheque])
    const por = new Map((data ?? []).map((x) => [x.id, x]))
    expect(por.get(r.abrilDevuelto)).toMatchObject({
      estado: 'devuelto',
      devolucion_salida: 'siguiente_recibo',
    })
    expect(por.get(r.agostoCheque)?.estado).toBe('cobrado_manual')
    expect(RECIBOS_POR_PAGINA).toBe(50)
  })

  it('pagina en la BD: 59 recibos en dos páginas, del más reciente al más antiguo, sin el borrado', async () => {
    sesion.actual = cDirectora
    const p1 = await historial(SIN_FILTRO)
    expect(p1).toMatchObject({ total: 59, pagina: 1, paginas: 2 })
    expect(p1.recibos).toHaveLength(50)
    // El primero, el de septiembre que creó el sobrante diferido.
    expect(p1.recibos[0]).toMatchObject({ id: await regularDe(9), anio: ANIO, mes: 9 })
    const claves = p1.recibos.map((x) => x.anio * 100 + x.mes)
    expect(claves).toEqual([...claves].sort((a, b) => b - a))

    const p2 = await historial(filtro({ pagina: 2 }))
    expect(p2.recibos).toHaveLength(9)
    const ids = [...p1.recibos, ...p2.recibos].map((x) => x.id)
    expect(new Set(ids).size).toBe(59)
    expect(ids).not.toContain(r.borrado)
    expect(ids).toContain(r.eneroBorrador)

    // Una página que no existe sirve la última.
    const fuera = await historial(filtro({ pagina: 99 }))
    expect(fuera).toMatchObject({ pagina: 2, paginas: 2 })
    expect(fuera.recibos.map((x) => x.id)).toEqual(p2.recibos.map((x) => x.id))
  })

  it('por mes, los enlaces llegan a recibos que el filtro deja fuera', async () => {
    sesion.actual = cDirectora
    const mayo = await regularDe(5)
    const septiembre = await regularDe(9)

    const abril = await historial(filtro({ anio: ANIO, mes: 4 }))
    expect(abril.recibos.map((x) => x.id)).toEqual([r.abrilDevuelto])
    expect(abril.recibos[0]).toMatchObject({
      estado: 'devuelto',
      familiaEtiqueta: expect.any(String),
      devolucion: { salida: 'siguiente_recibo', llevadaA: { reciboId: mayo, mes: 5 } },
    })

    const agosto = await historial(filtro({ anio: ANIO, mes: 8 }))
    expect(agosto.recibos[0]?.sobrante).toEqual({
      excesoCentimos: 1000,
      resueltoPor: 'diferir',
      diferidoA: { reciboId: septiembre, anio: ANIO, mes: 9 },
    })

    const sept = await historial(filtro({ anio: ANIO, mes: 9 }))
    expect(sept.recibos[0]?.incluye).toEqual([
      { reciboId: r.agostoCheque, anio: ANIO, mes: 8, tipo: 'sobrante', importeCentimos: -1000 },
    ])
  })

  it('por familia y por niño: solo lo suyo, y no lo del hermano', async () => {
    sesion.actual = cDirectora
    expect((await historial(filtro({ familiaId: familia }))).total).toBe(7)
    expect((await historial(filtro({ familiaId: otraFamilia }))).total).toBe(52)

    const delNino = await historial(filtro({ ninoId: nino }))
    expect(delNino.recibos.map((x) => x.id).sort()).toEqual(
      [r.eneroBorrador, r.eneroEsporadico].sort()
    )
    const delHermano = await historial(filtro({ ninoId: hermano }))
    expect(delHermano.recibos.map((x) => x.id)).toEqual([r.febreroHermano])
    // Niño y familia que no casan: nada.
    expect((await historial(filtro({ ninoId: nino, familiaId: otraFamilia }))).total).toBe(0)
    expect((await historial(filtro({ ninoId: ninoOtraFamilia }))).total).toBe(0)
  })

  it('los filtros ofrecen las familias y los niños del centro', async () => {
    sesion.actual = cDirectora
    const o = await getOpcionesHistorial(centro.id)
    expect(o.ok).toBe(true)
    if (!o.ok) return
    expect(o.familias.map((f) => f.id).sort()).toEqual([familia, otraFamilia].sort())
    expect(o.ninos.map((n) => n.id).sort()).toEqual([nino, hermano, ninoOtraFamilia].sort())
  })

  it('la Dirección de otro centro no ve nada de este', async () => {
    sesion.actual = cDirectoraOtro
    expect(await getHistorialRecibosGeneral(centro.id, SIN_FILTRO)).toMatchObject({
      ok: true,
      total: 0,
      recibos: [],
    })
    expect(await getOpcionesHistorial(centro.id)).toEqual({ ok: true, familias: [], ninos: [] })
  })
})
