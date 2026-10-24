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
 * PR-14 (`20261117120000`) — la devolución llevada al siguiente recibo, contra la BD real.
 *
 *  - La cuarta salida: una LÍNEA en el siguiente recibo en borrador de la familia (el del primer mes
 *    posterior), por total + gastos, familiar y manual, con su origen. El original se queda
 *    `devuelto` con su salida. Atómico, en `resolver_devolucion`.
 *  - Sin borrador posterior, no se ofrece (P0001 `sin_recibo_siguiente`), sin tocar nada.
 *  - La línea no se edita ni se crea por otro camino, tampoco con service_role.
 *  - Borrar la línea (a mano, o borrando su recibo) deja la devolución SIN RESOLVER, y se puede
 *    resolver otra vez. Con el recibo de destino validado, la línea ya no se quita.
 *  - El motor la respeta al regenerar. Dos devoluciones al mismo recibo: dos líneas.
 *  - El recibo de destino que también se devuelve se trata igual: su total ya incluye la línea.
 */

type Recibo = Database['public']['Tables']['recibos']['Insert']

const ANIO = 2026

describe('PR-14 — la devolución llevada al siguiente recibo', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let familiaSinBorrador: string
  let directora: TestUser
  let directoraOtro: TestUser
  let tutora: TestUser
  let cDirectora: SupabaseClient<Database>
  let original: string
  let segunda: string
  let julio: string
  let agosto: string

  async function recibo(familiaId: string, over: Partial<Recibo>): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        anio: ANIO,
        metodo: 'sepa',
        es_esporadico: false,
        mes: 1,
        estado: 'borrador',
        total_centimos: 0,
        ...over,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  async function borrador(familiaId: string, mes: number): Promise<string> {
    const id = await recibo(familiaId, { mes, total_centimos: 50000 })
    const { error } = await serviceClient.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: id,
      descripcion: 'Escolaridad PR14',
      cantidad: 1,
      precio_unitario_centimos: 50000,
      importe_centimos: 50000,
    })
    if (error) throw new Error(`línea: ${error.message}`)
    return id
  }

  /** Un recibo enviado al banco y devuelto por Dirección (camino real), con sus gastos. */
  async function devuelto(
    familiaId: string,
    mes: number,
    gastos: number,
    over: Partial<Recibo> = {}
  ): Promise<string> {
    const envio = `${ANIO}-${String(mes).padStart(2, '0')}-05`
    const id = await recibo(familiaId, {
      mes,
      estado: 'enviado_banco',
      fecha_envio_banco: envio,
      total_centimos: 10000,
      ...over,
    })
    const { error } = await cDirectora
      .from('recibos')
      .update({
        estado: 'devuelto',
        fecha_devolucion: `${ANIO}-${String(mes).padStart(2, '0')}-20`,
        devolucion_gastos_centimos: gastos,
      })
      .eq('id', id)
      .select('id')
      .single()
    if (error) throw new Error(`devolver: ${error.message}`)
    return id
  }

  function resolver(
    cliente: SupabaseClient<Database>,
    id: string,
    salida: string,
    fecha: string | null = null
  ) {
    return cliente.rpc('resolver_devolucion', {
      p_recibo_id: id,
      p_salida: salida,
      p_fecha: fecha as string,
      p_nota: null as unknown as string,
    })
  }

  async function estado(id: string) {
    const { data } = await serviceClient
      .from('recibos')
      .select(
        'estado, total_centimos, devolucion_salida, devolucion_gastos_centimos, fecha_devolucion'
      )
      .eq('id', id)
      .single()
    return data
  }

  async function lineas(reciboId: string) {
    const { data } = await serviceClient
      .from('lineas_recibo')
      .select(
        'id, nino_id, concepto_id, descripcion, cantidad, importe_centimos, origen, arrastre_de_recibo_id'
      )
      .eq('recibo_id', reciboId)
      .order('created_at')
    return data ?? []
  }

  async function sumaLineas(reciboId: string): Promise<number> {
    return (await lineas(reciboId)).reduce((a, l) => a + l.importe_centimos, 0)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Devolucion Siguiente PR14')
    otroCentro = await createTestCentro('Otro Centro Devolucion PR14')
    familia = (await createTestNino(centro.id, 'Nino Devolucion Siguiente PR14')).familia_id
    familiaSinBorrador = (await createTestNino(centro.id, 'Nino Sin Borrador PR14')).familia_id

    directora = await createTestUser({ nombre: 'Directora Devolucion PR14' })
    await asignarRol(directora.id, centro.id, 'directora')
    cDirectora = await clientFor(directora)
    directoraOtro = await createTestUser({ nombre: 'Directora Otro Centro PR14' })
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    tutora = await createTestUser({ nombre: 'Tutora Devolucion PR14' })
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutora.id)

    // El devuelto de junio; borradores de julio y agosto (se lleva al de julio, el primero).
    original = await devuelto(familia, 6, 350)
    julio = await borrador(familia, 7)
    agosto = await borrador(familia, 8)
  }, 120_000)

  afterAll(async () => {
    for (const c of [centro, otroCentro]) {
      // Primero las líneas (la del arrastre apunta al recibo de origen), después los recibos.
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [directora, directoraOtro, tutora]) await deleteTestUser(u.id)
  }, 120_000)

  it('sin un borrador de un mes posterior, esta salida no se ofrece y no se toca nada', async () => {
    const sinBorrador = await devuelto(familiaSinBorrador, 6, 0)
    // Un borrador del mismo mes no cuenta: tiene que ser posterior.
    await borrador(familiaSinBorrador, 5)
    const r = await resolver(cDirectora, sinBorrador, 'siguiente_recibo')
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.hint).toBe('sin_recibo_siguiente')
    expect(await estado(sinBorrador)).toMatchObject({ estado: 'devuelto', devolucion_salida: null })
  })

  it('fuera: el tutor y la Dirección de otro centro no la resuelven', async () => {
    for (const u of [tutora, directoraOtro]) {
      const r = await resolver(await clientFor(u), original, 'siguiente_recibo')
      expect(r.error, u.id).not.toBeNull()
    }
    expect(await estado(original)).toMatchObject({ devolucion_salida: null })
    expect(await lineas(julio)).toHaveLength(1)
  })

  it('Dirección la lleva al siguiente recibo: una línea por total + gastos, con su origen', async () => {
    // Premisa: julio vale 500 € y el devuelto, 100 € + 3,50 € de gastos.
    expect(await estado(julio)).toMatchObject({ total_centimos: 50000 })
    const { data, error } = await resolver(cDirectora, original, 'siguiente_recibo')
    expect(error).toBeNull()
    expect(data).toBe(julio)

    const deJulio = await lineas(julio)
    const arrastre = deJulio.find((l) => l.arrastre_de_recibo_id === original)
    expect(arrastre).toMatchObject({
      nino_id: null,
      concepto_id: null,
      descripcion: 'Recibo devuelto de junio de 2026 (con los gastos de la devolución)',
      cantidad: 1,
      importe_centimos: 10350,
      origen: 'manual',
    })
    expect(await estado(julio)).toMatchObject({ estado: 'borrador', total_centimos: 60350 })
    // El original se queda devuelto, con su salida, su total, sus gastos y su fecha.
    expect(await estado(original)).toMatchObject({
      estado: 'devuelto',
      total_centimos: 10000,
      devolucion_salida: 'siguiente_recibo',
      devolucion_gastos_centimos: 350,
      fecha_devolucion: `${ANIO}-06-20`,
    })
    // Agosto, intacto.
    expect(await lineas(agosto)).toHaveLength(1)
  })

  it('una segunda salida se rechaza', async () => {
    for (const [salida, fecha] of [
      ['siguiente_recibo', null],
      ['banco', null],
      ['efectivo', `${ANIO}-06-25`],
    ] as const) {
      const r = await resolver(cDirectora, original, salida, fecha)
      expect(r.error?.hint, salida).toBe('devolucion_ya_resuelta')
    }
    expect((await lineas(julio)).filter((l) => l.arrastre_de_recibo_id)).toHaveLength(1)
  })

  it('la línea no se edita ni se crea por otro camino, tampoco con service_role', async () => {
    const arrastre = (await lineas(julio)).find((l) => l.arrastre_de_recibo_id === original)!
    for (const cliente of [cDirectora, serviceClient]) {
      const editada = await cliente
        .from('lineas_recibo')
        .update({ importe_centimos: 1, precio_unitario_centimos: 1 })
        .eq('id', arrastre.id)
      expect(editada.error?.hint).toBe('linea_arrastre')
      const nueva = await cliente.from('lineas_recibo').insert({
        centro_id: centro.id,
        recibo_id: agosto,
        descripcion: 'Arrastre a mano PR14',
        cantidad: 1,
        precio_unitario_centimos: 10350,
        importe_centimos: 10350,
        origen: 'manual',
        arrastre_de_recibo_id: original,
      })
      expect(nueva.error?.hint).toBe('arrastre_por_funcion')
    }
    // Y la salida no se quita a mano: solo borrando la línea.
    const quitada = await cDirectora
      .from('recibos')
      .update({ devolucion_salida: null })
      .eq('id', original)
    expect(quitada.error?.hint).toBe('devolucion_ya_resuelta')
    expect((await lineas(julio)).find((l) => l.id === arrastre.id)?.importe_centimos).toBe(10350)
  })

  it('el motor la respeta al regenerar el mes', async () => {
    const { error } = await cDirectora.rpc('generar_recibos_mes', {
      p_centro_id: centro.id,
      p_anio: ANIO,
      p_mes: 7,
    })
    expect(error).toBeNull()
    const deJulio = await lineas(julio)
    expect(deJulio.filter((l) => l.arrastre_de_recibo_id === original)).toHaveLength(1)
    expect((await estado(julio))?.total_centimos).toBe(await sumaLineas(julio))
  })

  it('quitar la línea deja la devolución sin resolver, y se puede resolver otra vez', async () => {
    const arrastre = (await lineas(julio)).find((l) => l.arrastre_de_recibo_id === original)!
    const { error } = await cDirectora.from('lineas_recibo').delete().eq('id', arrastre.id)
    expect(error).toBeNull()
    expect(await estado(original)).toMatchObject({
      estado: 'devuelto',
      devolucion_salida: null,
      devolucion_gastos_centimos: 350,
      fecha_devolucion: `${ANIO}-06-20`,
    })
    // Se vuelve a llevar (una línea por devolución: la vieja ya no está).
    const otra = await resolver(cDirectora, original, 'siguiente_recibo')
    expect(otra.error).toBeNull()
    expect((await lineas(julio)).filter((l) => l.arrastre_de_recibo_id === original)).toHaveLength(
      1
    )
  })

  it('borrar el recibo de destino también la deja sin resolver', async () => {
    // El borrador de julio se borra entero (lo hace el servicio: Dirección no borra recibos), y la
    // línea cae en cascada con él.
    const { error } = await serviceClient.from('recibos').delete().eq('id', julio)
    expect(error).toBeNull()
    expect(await estado(original)).toMatchObject({ estado: 'devuelto', devolucion_salida: null })
    julio = await borrador(familia, 7)
    const otra = await resolver(cDirectora, original, 'siguiente_recibo')
    expect(otra.error).toBeNull()
    expect(otra.data).toBe(julio)
  })

  it('dos devoluciones al mismo recibo: dos líneas, cada una con su origen', async () => {
    // Un esporádico de junio, también devuelto, sin gastos.
    segunda = await devuelto(familia, 6, 0, {
      es_esporadico: true,
      concepto_esporadico: 'Excursión PR14',
      total_centimos: 2500,
    })
    const r = await resolver(cDirectora, segunda, 'siguiente_recibo')
    expect(r.error).toBeNull()
    expect(r.data).toBe(julio)
    const arrastres = (await lineas(julio)).filter((l) => l.arrastre_de_recibo_id)
    expect(arrastres.map((l) => [l.arrastre_de_recibo_id, l.importe_centimos]).sort()).toEqual(
      [
        [original, 10350],
        [segunda, 2500],
      ].sort()
    )
    expect(arrastres.find((l) => l.arrastre_de_recibo_id === segunda)?.descripcion).toBe(
      'Recibo devuelto de junio de 2026'
    )
    expect(await estado(julio)).toMatchObject({ total_centimos: 50000 + 10350 + 2500 })
  })

  it('con el recibo de destino validado, la línea ya no se quita y la devolución sigue resuelta', async () => {
    const { error } = await cDirectora
      .from('recibos')
      .update({ estado: 'pendiente_procesar' })
      .eq('id', julio)
      .select('id')
      .single()
    expect(error).toBeNull()
    const arrastre = (await lineas(julio)).find((l) => l.arrastre_de_recibo_id === original)!
    const quitada = await cDirectora.from('lineas_recibo').delete().eq('id', arrastre.id)
    expect(quitada.error?.code).toBe('P0001')
    expect(await estado(original)).toMatchObject({ devolucion_salida: 'siguiente_recibo' })
  })

  it('si el recibo de destino también se devuelve, se trata igual: su total ya incluye la línea', async () => {
    const totalJulio = (await estado(julio))!.total_centimos
    expect(totalJulio).toBe(50000 + 10350 + 2500)
    await serviceClient
      .from('recibos')
      .update({ estado: 'enviado_banco', fecha_envio_banco: `${ANIO}-07-05` })
      .eq('id', julio)
    const { error: errDev } = await cDirectora
      .from('recibos')
      .update({
        estado: 'devuelto',
        fecha_devolucion: `${ANIO}-07-20`,
        devolucion_gastos_centimos: 200,
      })
      .eq('id', julio)
      .select('id')
      .single()
    expect(errDev).toBeNull()
    const r = await resolver(cDirectora, julio, 'siguiente_recibo')
    expect(r.error).toBeNull()
    expect(r.data).toBe(agosto)
    const deAgosto = (await lineas(agosto)).find((l) => l.arrastre_de_recibo_id === julio)
    expect(deAgosto).toMatchObject({
      importe_centimos: totalJulio + 200,
      descripcion: 'Recibo devuelto de julio de 2026 (con los gastos de la devolución)',
    })
    expect(await estado(agosto)).toMatchObject({ total_centimos: 50000 + totalJulio + 200 })
  })
})
