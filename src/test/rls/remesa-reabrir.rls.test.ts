import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import {
  anonClient,
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'
import { borrarMandatos, insertarMandato } from './mandatos-como-postgres'
import {
  ficherosDeLaRemesa,
  insertarRecibos,
  ponerMarcaComoElRegistro,
} from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Reabrir una remesa (`20261227120000`), contra la BD real y por sus funciones.
 *
 *  - La admin del centro reabre una remesa enviada o con el fichero generado: sus recibos enviados
 *    vuelven a pendiente sin fecha de envío, la remesa a borrador sin fecha ni marca, y el fichero
 *    guardado se queda, con `reabierta_at`. La descarga siguiente es una versión nueva. Queda su fila
 *    `remesa_reabierta` en audit_log.
 *  - El aviso (`resumen_reabrir_remesa`) y la comprobación de `reabrir_remesa` leen la misma consulta:
 *    con un número o un importe que no es el que se vio, no reabre (`remesa_cambiada`).
 *  - Los devueltos y los cobrados a mano no se tocan, y no salen de la remesa reabierta
 *    (`recibo_con_historia`): son la prueba de que el banco recibió el fichero.
 *  - Un borrador sin fichero no se reabre, y se dice por qué (`nada_que_reabrir`).
 *  - Una remesa enviada no vuelve a borrador por fuera, tampoco con service_role.
 *  - Ni la directora, ni el superusuario, ni la profe, ni la admin de otro centro, ni anon.
 */

const BUCKET = 'remesas-ficheros'

const MNDT_A = 'NIDO-REAB-000A'
const MNDT_B = 'NIDO-REAB-000B'

describe('Reabrir una remesa', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familiaA: string
  let familiaB: string
  let admin: TestUser
  let directora: TestUser
  let profe: TestUser
  let superusuario: TestUser
  let adminOtro: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let cAdmin: SupabaseClient<Database>
  let cDirectora: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  let cSuper: SupabaseClient<Database>
  let cAdminOtro: SupabaseClient<Database>
  let segundo = 0
  const mandatoDe = new Map<string, string>()

  async function recibo(familia: string): Promise<string> {
    const [id] = await insertarRecibos([
      {
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 5,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Reabrir remesa',
      },
    ])
    mandatoDe.set(id, familia === familiaA ? MNDT_A : MNDT_B)
    return id
  }

  async function remesaCon(recibos: string[]): Promise<string> {
    const { data, error } = await cAdmin
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2026, mes: 5 })
      .select('id')
      .single()
    if (error || !data) throw new Error(`remesa: ${error?.message}`)
    for (const rc of recibos) {
      const e = await cAdmin
        .from('recibos_remesa')
        .insert({ centro_id: centro.id, remesa_id: data.id, recibo_id: rc })
      if (e.error) throw new Error(`enlace: ${e.error.message}`)
    }
    return data.id
  }

  /** La descarga: sube el fichero y lo registra con la sesión de la admin, una marca por versión. */
  async function descargar(remesa: string, recibos: string[]): Promise<string> {
    segundo += 1
    const d = new Date()
    d.setUTCMilliseconds(0)
    d.setUTCSeconds(d.getUTCSeconds() + segundo)
    const msgId = `NIDO-${remesa.slice(0, 8)}-2026050100${String(segundo).padStart(4, '0')}`
    const ruta = `${centro.id}/${remesa}/${msgId}.xml`
    const up = await serviceClient.storage
      .from(BUCKET)
      .upload(ruta, '<Document/>', { contentType: 'application/xml', upsert: false })
    if (up.error) throw new Error(`subir: ${up.error.message}`)
    const r = await cAdmin.rpc('registrar_fichero_remesa', {
      p_remesa_id: remesa,
      p_marca: d.toISOString(),
      p_msg_id: msgId,
      p_sha256: 'a'.repeat(64),
      p_ruta: ruta,
      p_adeudos: recibos.map((rc) => ({
        recibo_id: rc,
        end_to_end_id: rc.replace(/-/g, '').toUpperCase(),
        importe_centimos: 10000,
        mndt_id: mandatoDe.get(rc),
      })) as never,
    })
    if (r.error) throw new Error(`registrar: ${r.error.message} (${r.error.hint})`)
    return msgId
  }

  /** Una remesa enviada al banco por el camino de verdad: descargada y marcada enviada. */
  async function enviadaCon(recibos: string[]): Promise<string> {
    const rem = await remesaCon(recibos)
    await descargar(rem, recibos)
    const m = await cAdmin.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    if (m.error) throw new Error(`marcar enviada: ${m.error.message} (${m.error.hint})`)
    return rem
  }

  async function remesaDe(id: string) {
    const { data } = await serviceClient
      .from('remesas')
      .select('estado, fecha_envio_banco, fichero_generado_at')
      .eq('id', id)
      .single()
    return data
  }

  async function estados(ids: string[]): Promise<Record<string, string>> {
    const { data } = await serviceClient
      .from('recibos')
      .select('id, estado, fecha_envio_banco')
      .in('id', ids)
    return Object.fromEntries((data ?? []).map((r) => [r.id, `${r.estado}/${r.fecha_envio_banco}`]))
  }

  async function resumen(c: SupabaseClient<Database>, remesa: string) {
    return c.rpc('resumen_reabrir_remesa', { p_remesa_id: remesa })
  }

  async function reabrir(
    c: SupabaseClient<Database>,
    remesa: string,
    n: number,
    total: number
  ): Promise<{ data: unknown; error: { code?: string; hint?: string; message: string } | null }> {
    return c.rpc('reabrir_remesa', {
      p_remesa_id: remesa,
      p_n_recibos: n,
      p_total_centimos: total,
    })
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Reabrir Remesa')
    otroCentro = await createTestCentro('Otro Centro Reabrir Remesa')
    familiaA = await createTestFamilia(centro.id)
    familiaB = await createTestFamilia(centro.id)
    admin = await createTestUser({ nombre: 'Admin Reabrir Remesa' })
    directora = await createTestUser({ nombre: 'Directora Reabrir Remesa' })
    profe = await createTestUser({ nombre: 'Profe Reabrir Remesa' })
    superusuario = await createTestUser({ nombre: 'Superusuario Reabrir Remesa' })
    adminOtro = await createTestUser({ nombre: 'Admin Otra Reabrir Remesa' })
    tutorA = await createTestUser({ nombre: 'Tutor A Reabrir Remesa' })
    tutorB = await createTestUser({ nombre: 'Tutor B Reabrir Remesa' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(adminOtro.id, otroCentro.id, 'admin')
    await asignarRol(tutorA.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
    await crearFamiliaTutor(familiaB, tutorB.id, 'titular')
    const sup = await serviceClient.from('platform_admins').insert({ usuario_id: superusuario.id })
    if (sup.error) throw new Error(`superusuario: ${sup.error.message}`)
    cAdmin = await clientFor(admin)
    cDirectora = await clientFor(directora)
    cProfe = await clientFor(profe)
    cSuper = await clientFor(superusuario)
    cAdminOtro = await clientFor(adminOtro)
    for (const [familia, tutor, mndt] of [
      [familiaA, tutorA, MNDT_A],
      [familiaB, tutorB, MNDT_B],
    ] as const) {
      const { error } = insertarMandato({
        centro_id: centro.id,
        familia_id: familia,
        usuario_id: tutor.id,
        iban_cifrado: '\\x00',
        titular: 'Tutor Reabrir Remesa',
        identificador_mandato: mndt,
        estado: 'activo',
      })
      if (error) throw new Error(`mandato: ${error.message}`)
    }
  }, 180_000)

  afterAll(async () => {
    const { data: carpetas } = await serviceClient.storage.from(BUCKET).list(centro.id, {
      limit: 1000,
    })
    for (const c of carpetas ?? []) {
      const { data } = await serviceClient.storage.from(BUCKET).list(`${centro.id}/${c.name}`)
      const rutas = (data ?? []).map((o) => `${centro.id}/${c.name}/${o.name}`)
      if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
    }
    // Los registros de hoy no vencen y sujetan sus recibos y remesas (RESTRICT): en la BD efímera
    // se quedan, como en el test de R-1.
    await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      borrarMandatos('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [admin, directora, profe, superusuario, adminOtro, tutorA, tutorB])
      await deleteTestUser(u.id)
  }, 180_000)

  it('la admin reabre una enviada: recibos a pendiente, remesa a borrador, el fichero se queda', async () => {
    const r1 = await recibo(familiaA)
    const r2 = await recibo(familiaB)
    const rem = await enviadaCon([r1, r2])
    // Premisa: enviada de verdad, con su marca, y sus dos recibos en el banco.
    expect(await remesaDe(rem)).toMatchObject({ estado: 'enviada' })
    expect((await remesaDe(rem))?.fichero_generado_at).not.toBeNull()
    expect(
      Object.values(await estados([r1, r2])).every((e) => e.startsWith('enviado_banco/'))
    ).toBe(true)

    const aviso = await resumen(cAdmin, rem)
    expect(aviso.error).toBeNull()
    expect(aviso.data).toMatchObject({
      estado: 'enviada',
      fichero_guardado: true,
      n_recibos: 2,
      n_familias: 2,
      total_centimos: 20000,
      n_enviados: 2,
      n_devueltos: 0,
      n_cobrados: 0,
    })

    const r = await reabrir(cAdmin, rem, 2, 20000)
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ n_a_pendiente: 2 })
    expect(await remesaDe(rem)).toEqual({
      estado: 'borrador',
      fecha_envio_banco: null,
      fichero_generado_at: null,
    })
    expect(await estados([r1, r2])).toEqual({
      [r1]: 'pendiente_procesar/null',
      [r2]: 'pendiente_procesar/null',
    })
    // El fichero de la versión enviada se queda, marcado reabierto: es la prueba de lo que se envió.
    expect(ficherosDeLaRemesa(rem)).toEqual([
      expect.objectContaining({ reabierta: true, enviada: true }),
    ])

    const { data: fila } = await serviceClient
      .from('audit_log')
      .select('usuario_id, centro_id, accion, valores_antes, valores_despues')
      .eq('tabla', 'remesa_reabierta')
      .eq('registro_id', rem)
      .single()
    expect(fila).toMatchObject({
      usuario_id: admin.id,
      centro_id: centro.id,
      accion: 'UPDATE',
      valores_antes: { estado: 'enviada' },
      valores_despues: {
        n_recibos: 2,
        n_familias: 2,
        total_centimos: 20000,
        n_a_pendiente: 2,
        n_devueltos: 0,
        n_cobrados: 0,
      },
    })

    // Reabierta, se edita y la descarga siguiente es otra versión, con otro MsgId.
    const fuera = await cAdmin.from('recibos_remesa').delete().eq('recibo_id', r2)
    expect(fuera.error).toBeNull()
    const msgNuevo = await descargar(rem, [r1])
    const ficheros = ficherosDeLaRemesa(rem)
    expect(ficheros).toHaveLength(2)
    expect(ficheros[1]).toMatchObject({ msgId: msgNuevo, reabierta: false, enviada: false })
    expect(ficheros[0].msgId).not.toBe(msgNuevo)
  })

  it('con un número o un importe que no es el que se vio, no reabre', async () => {
    const r1 = await recibo(familiaA)
    const rem = await enviadaCon([r1])
    // Premisa: el aviso dice 1 recibo y 100 €.
    expect((await resumen(cAdmin, rem)).data).toMatchObject({ n_recibos: 1, total_centimos: 10000 })
    for (const [n, total] of [
      [1, 9999],
      [2, 10000],
    ]) {
      const r = await reabrir(cAdmin, rem, n, total)
      expect.soft(r.error?.hint, `${n}/${total}`).toBe('remesa_cambiada')
    }
    expect(await remesaDe(rem)).toMatchObject({ estado: 'enviada' })
    expect((await estados([r1]))[r1]).toMatch(/^enviado_banco\//)
  })

  it('los devueltos y los cobrados no se tocan, y no salen de la remesa reabierta', async () => {
    const enviado = await recibo(familiaA)
    const devuelto = await recibo(familiaA)
    const cobrado = await recibo(familiaB)
    const rem = await enviadaCon([enviado, devuelto, cobrado])
    const hoy = hoyMadrid()
    for (const id of [devuelto, cobrado]) {
      const d = await cAdmin.rpc('marcar_recibo_devuelto', {
        p_recibo_id: id,
        p_fecha: hoy,
        p_gastos_centimos: 0,
      })
      if (d.error) throw new Error(`devolver: ${d.error.message}`)
    }
    const c = await cAdmin.rpc('resolver_devolucion', {
      p_recibo_id: cobrado,
      p_salida: 'efectivo',
      p_fecha: hoy,
      p_nota: null as unknown as string,
    })
    if (c.error) throw new Error(`cobrar: ${c.error.message} (${c.error.hint})`)
    const antes = await estados([devuelto, cobrado])
    // Premisa: uno en el banco, uno devuelto y uno cobrado a mano.
    expect((await estados([enviado]))[enviado]).toMatch(/^enviado_banco\//)
    expect(antes[devuelto]).toMatch(/^devuelto\//)
    expect(antes[cobrado]).toMatch(/^cobrado_manual\//)

    expect((await resumen(cAdmin, rem)).data).toMatchObject({
      n_recibos: 1,
      n_familias: 1,
      total_centimos: 10000,
      n_enviados: 1,
      n_devueltos: 1,
      n_cobrados: 1,
    })
    const r = await reabrir(cAdmin, rem, 1, 10000)
    expect(r.error).toBeNull()
    expect((await estados([enviado]))[enviado]).toBe('pendiente_procesar/null')
    expect(await estados([devuelto, cobrado])).toEqual(antes)

    for (const [caso, id] of [
      ['devuelto', devuelto],
      ['cobrado', cobrado],
    ]) {
      const quitar = await cAdmin.from('recibos_remesa').delete().eq('recibo_id', id)
      expect.soft(quitar.error?.hint, caso).toBe('recibo_con_historia')
    }
    const { count } = await serviceClient
      .from('recibos_remesa')
      .select('recibo_id', { count: 'exact', head: true })
      .eq('remesa_id', rem)
      .in('recibo_id', [devuelto, cobrado])
    expect(count).toBe(2)
    // Control positivo: de la misma remesa reabierta, el pendiente sí sale.
    const pendiente = await cAdmin
      .from('recibos_remesa')
      .delete()
      .eq('recibo_id', enviado)
      .select('recibo_id')
    expect(pendiente.error).toBeNull()
    expect(pendiente.data).toHaveLength(1)
  })

  it('un borrador sin fichero no se reabre, y lo dice: nunca se generó el fichero', async () => {
    const rem = await remesaCon([await recibo(familiaA)])
    // Premisa: borrador y sin marca.
    expect(await remesaDe(rem)).toEqual({
      estado: 'borrador',
      fecha_envio_banco: null,
      fichero_generado_at: null,
    })
    const r = await reabrir(cAdmin, rem, 1, 10000)
    expect(r.error?.hint).toBe('nada_que_reabrir')
    expect(r.error?.message).toMatch(/no se ha generado nunca/)
  })

  it('un borrador con el fichero descargado se reabre: pierde la marca y vuelve a editarse', async () => {
    const r1 = await recibo(familiaA)
    const rem = await remesaCon([r1])
    await descargar(rem, [r1])
    // Premisa: borrador con marca, y con la marca no sale ningún recibo.
    expect((await remesaDe(rem))?.fichero_generado_at).not.toBeNull()
    const antes = await cAdmin.from('recibos_remesa').delete().eq('recibo_id', r1)
    expect(antes.error?.hint).toBe('remesa_con_fichero')

    const r = await reabrir(cAdmin, rem, 1, 10000)
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ n_a_pendiente: 0 })
    expect(await remesaDe(rem)).toMatchObject({ estado: 'borrador', fichero_generado_at: null })
    expect(ficherosDeLaRemesa(rem)).toEqual([
      expect.objectContaining({ reabierta: true, enviada: false }),
    ])
    const despues = await cAdmin.from('recibos_remesa').delete().eq('recibo_id', r1)
    expect(despues.error).toBeNull()
  })

  it('solo la admin del centro: ni la directora, ni el superusuario, ni la profe, ni otro centro, ni anon', async () => {
    const r1 = await recibo(familiaA)
    const rem = await enviadaCon([r1])
    // Premisa: la admin ve el aviso.
    expect((await resumen(cAdmin, rem)).error).toBeNull()
    const quienes: Array<[string, SupabaseClient<Database>]> = [
      ['directora', cDirectora],
      ['superusuario', cSuper],
      ['profe', cProfe],
      ['admin de otro centro', cAdminOtro],
      ['anon', anonClient()],
    ]
    for (const [quien, c] of quienes) {
      const a = await resumen(c, rem)
      expect.soft(a.error?.code, `${quien} resumen`).toBe('42501')
      const r = await reabrir(c, rem, 1, 10000)
      expect.soft(r.error?.code, `${quien} reabrir`).toBe('42501')
    }
    const s = await reabrir(serviceClient, rem, 1, 10000)
    expect.soft(s.error?.code, 'service_role reabrir').toBe('42501')
    expect(await remesaDe(rem)).toMatchObject({ estado: 'enviada' })
  })

  it('una enviada no vuelve a borrador por fuera, tampoco con service_role', async () => {
    // Cada uno con su remesa: si compartieran una, el que pasara primero dejaría al
    // segundo moviendo borrador → borrador, y su celda no mediría nada.
    for (const [quien, c] of [
      ['service_role', serviceClient],
      ['admin', cAdmin],
    ] as const) {
      const r1 = await recibo(familiaA)
      const rem = await enviadaCon([r1])
      // Premisa: enviada, y quien prueba escribe la remesa (un cambio que no toca su estado pasa).
      expect(await remesaDe(rem)).toMatchObject({ estado: 'enviada' })
      const toca = await c
        .from('remesas')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', rem)
        .select('id')
      expect.soft(toca.data, `${quien} premisa`).toHaveLength(1)
      const v = await c
        .from('remesas')
        .update({ estado: 'borrador', fecha_envio_banco: null })
        .eq('id', rem)
      expect.soft(v.error?.hint, `${quien} remesa`).toBe('remesa_cerrada')
      const rc = await c
        .from('recibos')
        .update({ estado: 'pendiente_procesar', fecha_envio_banco: null })
        .eq('id', r1)
      expect.soft(rc.error?.hint, `${quien} recibo`).toBe('hecho_de_dinero')
      const marca = await c.from('remesas').update({ fichero_generado_at: null }).eq('id', rem)
      expect.soft(marca.error?.hint, `${quien} marca`).toBe('fichero_generado')
      expect.soft(await remesaDe(rem), `${quien} final`).toMatchObject({ estado: 'enviada' })
      expect.soft((await estados([r1]))[r1], `${quien} recibo final`).toMatch(/^enviado_banco\//)
    }
  })

  it('service_role conserva el desvincular (la limpieza y lo fiscal): un devuelto sale con él', async () => {
    const r1 = await recibo(familiaA)
    const rem = await enviadaCon([r1])
    const d = await cAdmin.rpc('marcar_recibo_devuelto', {
      p_recibo_id: r1,
      p_fecha: hoyMadrid(),
      p_gastos_centimos: 0,
    })
    if (d.error) throw new Error(`devolver: ${d.error.message}`)
    expect((await reabrir(cAdmin, rem, 0, 0)).error).toBeNull()
    // Premisa: con la sesión no sale.
    const sesion = await cAdmin.from('recibos_remesa').delete().eq('recibo_id', r1)
    expect(sesion.error?.hint).toBe('recibo_con_historia')
    const servidor = await serviceClient
      .from('recibos_remesa')
      .delete()
      .eq('recibo_id', r1)
      .select('recibo_id')
    expect(servidor.error).toBeNull()
    expect(servidor.data).toHaveLength(1)
  })

  it('reabierta ya no tiene nada que reabrir hasta que vuelva a generarse el fichero', async () => {
    const r1 = await recibo(familiaA)
    const rem = await enviadaCon([r1])
    expect((await reabrir(cAdmin, rem, 1, 10000)).error).toBeNull()
    const otra = await reabrir(cAdmin, rem, 1, 10000)
    expect(otra.error?.hint).toBe('nada_que_reabrir')
    // Con una marca nueva (la siguiente descarga), vuelve a poder reabrirse.
    ponerMarcaComoElRegistro(rem, new Date().toISOString())
    expect((await reabrir(cAdmin, rem, 1, 10000)).error).toBeNull()
  })
})
