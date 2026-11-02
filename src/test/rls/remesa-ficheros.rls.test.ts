import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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
import { ponerMarcaComoElRegistro } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * El fichero de cada versión de una remesa, guardado con su registro (R-1, `20261220120000`),
 * contra la BD real.
 *
 *  - `registrar_fichero_remesa` pone la marca y el registro en una transacción, con la sesión de
 *    Dirección (que queda en audit_log como quien la puso). Exige el fichero en el bucket, los
 *    recibos cobrables de la remesa con su importe y su EndToEndId, y un mandato de su familia; una
 *    sola versión por marca. La profe, otro centro y anon, nada.
 *  - Las tablas y el bucket no son de nadie: ni las sesiones ni service_role los leen por la API.
 *  - El plazo es el fiscal desde la marca, y espera a la retención de una familia del fichero. El
 *    recibo de un fichero vivo no se borra.
 */

const BUCKET = 'remesas-ficheros'
const ANIOS = 6
const MNDT = 'NIDO-RFIC-0001'

describe('El fichero de cada versión de una remesa (R-1)', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let admin: TestUser
  let directora: TestUser
  let directoraOtro: TestUser
  let profe: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let cDirectora: SupabaseClient<Database>
  let cDirectoraOtro: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>

  async function recibo(total = 10000): Promise<string> {
    const { data, error } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 3,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: total,
        es_esporadico: true,
        concepto_esporadico: 'Fichero de remesa',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`recibo: ${error?.message}`)
    return data.id
  }

  /** Una remesa en borrador con ese recibo; con `marca`, ya marcada (como la pone el registro). */
  async function remesaCon(reciboId: string, marca?: string): Promise<string> {
    const { data, error } = await cDirectora
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2026, mes: 3 })
      .select('id')
      .single()
    if (error || !data) throw new Error(`remesa: ${error?.message}`)
    const e = await cDirectora
      .from('recibos_remesa')
      .insert({ centro_id: centro.id, remesa_id: data.id, recibo_id: reciboId })
    if (e.error) throw new Error(`enlace: ${e.error.message}`)
    // La marca solo la pone el registro (20261221120000): aquí, como él, sin el registro.
    if (marca) ponerMarcaComoElRegistro(data.id, marca)
    return data.id
  }

  const msgIdDe = (remesaId: string, sufijo: string) => `NIDO-${remesaId.slice(0, 8)}-${sufijo}`
  const rutaDe = (remesaId: string, msgId: string) => `${centro.id}/${remesaId}/${msgId}.xml`
  const adeudo = (reciboId: string, importe = 10000, mndt = MNDT) => ({
    recibo_id: reciboId,
    end_to_end_id: reciboId.replace(/-/g, '').toUpperCase(),
    importe_centimos: importe,
    mndt_id: mndt,
  })

  async function subir(ruta: string) {
    const { error } = await serviceClient.storage
      .from(BUCKET)
      .upload(ruta, '<Document/>', { contentType: 'application/xml', upsert: false })
    if (error) throw new Error(`subir: ${error.message}`)
  }

  function registrar(
    cliente: SupabaseClient<Database>,
    v: { remesa: string; marca: string; msgId: string; adeudos: unknown[]; ruta?: string }
  ) {
    return cliente.rpc('registrar_fichero_remesa', {
      p_remesa_id: v.remesa,
      p_marca: v.marca,
      p_msg_id: v.msgId,
      p_sha256: 'a'.repeat(64),
      p_ruta: v.ruta ?? rutaDe(v.remesa, v.msgId),
      p_adeudos: v.adeudos as never,
    })
  }

  async function marcaDe(remesaId: string): Promise<string | null> {
    const { data } = await serviceClient
      .from('remesas')
      .select('fichero_generado_at')
      .eq('id', remesaId)
      .single()
    return data?.fichero_generado_at ?? null
  }

  const ahora = () => {
    const d = new Date()
    d.setUTCMilliseconds(0)
    return d.toISOString()
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Remesa Ficheros')
    otroCentro = await createTestCentro('Otro Centro Remesa Ficheros')
    familia = await createTestFamilia(centro.id)

    admin = await createTestUser({ nombre: 'Admin Remesa Ficheros' })
    directora = await createTestUser({ nombre: 'Directora Remesa Ficheros' })
    directoraOtro = await createTestUser({ nombre: 'Directora Otra Remesa Ficheros' })
    profe = await createTestUser({ nombre: 'Profe Remesa Ficheros' })
    tutor = await createTestUser({ nombre: 'Tutor Remesa Ficheros' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cAdmin = await clientFor(admin)
    cDirectora = await clientFor(directora)
    cDirectoraOtro = await clientFor(directoraOtro)
    cProfe = await clientFor(profe)

    const { error } = await serviceClient.from('mandatos_sepa').insert({
      centro_id: centro.id,
      familia_id: familia,
      usuario_id: tutor.id,
      iban_cifrado: '\\x00',
      titular: 'Tutor Remesa Ficheros',
      identificador_mandato: MNDT,
      estado: 'activo',
    })
    if (error) throw new Error(`mandato: ${error.message}`)
  }, 180_000)

  afterAll(async () => {
    const { data: objetos } = await serviceClient.storage.from(BUCKET).list(centro.id, {
      limit: 1000,
    })
    for (const carpeta of objetos ?? []) {
      const { data } = await serviceClient.storage.from(BUCKET).list(`${centro.id}/${carpeta.name}`)
      const rutas = (data ?? []).map((o) => `${centro.id}/${carpeta.name}/${o.name}`)
      if (rutas.length) await serviceClient.storage.from(BUCKET).remove(rutas)
    }
    // Los registros solo se borran por su función, al vencer: los de hoy se quedan, y con ellos
    // sus recibos y sus remesas (RESTRICT). En la BD efímera no importa, y `deleteTestCentro` lo
    // dice sin tumbar el fichero.
    const { data: vencidos } = await serviceClient.rpc('ficheros_remesa_vencidos', { p_anios: 1 })
    for (const v of vencidos ?? [])
      await serviceClient.rpc('destruir_fichero_remesa', { p_fichero_id: v.fichero_id, p_anios: 1 })
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      await serviceClient.from('mandatos_sepa').delete().eq('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [admin, directora, directoraOtro, profe, tutor]) await deleteTestUser(u.id)
  }, 180_000)

  it('Dirección registra la versión: la marca y el registro en una transacción, con su nombre en audit_log', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const marca = ahora()
    const msgId = msgIdDe(rem, '20260301000001')
    await subir(rutaDe(rem, msgId))
    // Premisa: la remesa no tiene marca.
    expect(await marcaDe(rem)).toBeNull()

    const r = await registrar(cDirectora, { remesa: rem, marca, msgId, adeudos: [adeudo(rc)] })
    expect(r.error).toBeNull()
    expect(new Date((await marcaDe(rem))!).toISOString()).toBe(marca)

    const v = await cDirectora.rpc('fichero_remesa_vigente', { p_remesa_id: rem })
    expect(v.error).toBeNull()
    expect(v.data).toEqual([
      expect.objectContaining({ msg_id: msgId, ruta: rutaDe(rem, msgId), sha256: 'a'.repeat(64) }),
    ])

    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'remesas')
      .eq('registro_id', rem)
      .eq('accion', 'UPDATE')
    expect(audit?.map((a) => a.usuario_id)).toContain(directora.id)
  })

  it('una sola versión por marca, y no otra marca encima', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const marca = ahora()
    const msgId = msgIdDe(rem, '20260301000002')
    await subir(rutaDe(rem, msgId))
    expect(
      (await registrar(cDirectora, { remesa: rem, marca, msgId, adeudos: [adeudo(rc)] })).error
    ).toBeNull()

    const otra = await registrar(cDirectora, { remesa: rem, marca, msgId, adeudos: [adeudo(rc)] })
    expect(otra.error?.hint).toBe('ya_guardado')
    const encima = await registrar(cDirectora, {
      remesa: rem,
      marca: new Date(Date.parse(marca) + 1000).toISOString(),
      msgId,
      adeudos: [adeudo(rc)],
    })
    expect(encima.error?.hint).toBe('marca_distinta')
  })

  it('sin el fichero en el bucket no registra nada, ni pone la marca', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const r = await registrar(cDirectora, {
      remesa: rem,
      marca: ahora(),
      msgId: msgIdDe(rem, '20260301000003'),
      adeudos: [adeudo(rc)],
    })
    expect(r.error?.hint).toBe('sin_fichero')
    expect(await marcaDe(rem)).toBeNull()
  })

  it.each([
    ['otro importe', (rc: string) => [adeudo(rc, 9999)]],
    ['un recibo de menos', () => []],
    ['un mandato que no es de la familia', (rc: string) => [adeudo(rc, 10000, 'NIDO-OTRO-0001')]],
  ])('si los adeudos no son los recibos de la remesa (%s), nada', async (_, adeudos) => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const msgId = msgIdDe(rem, '20260301000004')
    await subir(rutaDe(rem, msgId))
    const r = await registrar(cDirectora, {
      remesa: rem,
      marca: ahora(),
      msgId,
      adeudos: adeudos(rc),
    })
    expect(r.error?.hint).toBe('recibos_cambiaron')
    expect(await marcaDe(rem)).toBeNull()
  })

  it('la ruta tiene que ser la de esa remesa', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const otraRem = await remesaCon(await recibo())
    const msgId = msgIdDe(rem, '20260301000005')
    await subir(rutaDe(otraRem, msgId))
    const r = await registrar(cDirectora, {
      remesa: rem,
      marca: ahora(),
      msgId,
      adeudos: [adeudo(rc)],
      ruta: rutaDe(otraRem, msgId),
    })
    expect(r.error?.hint).toBe('ruta_no_valida')
  })

  it('la profe, la directora de otro centro y anon no registran ni leen la versión', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const msgId = msgIdDe(rem, '20260301000006')
    await subir(rutaDe(rem, msgId))
    for (const c of [cProfe, cDirectoraOtro]) {
      const r = await registrar(c, { remesa: rem, marca: ahora(), msgId, adeudos: [adeudo(rc)] })
      expect(r.error?.code).toBe('42501')
      expect((await c.rpc('fichero_remesa_vigente', { p_remesa_id: rem })).error?.code).toBe(
        '42501'
      )
    }
    expect(await marcaDe(rem)).toBeNull()
  })

  it('las tablas y el bucket no son de nadie por la API, tampoco de service_role', async () => {
    for (const c of [cDirectora, serviceClient]) {
      expect((await c.from('remesa_ficheros' as never).select('id')).error?.code).toBe('42501')
      expect(
        (await c.from('remesa_fichero_adeudos' as never).select('recibo_id')).error?.code
      ).toBe('42501')
    }
    const { data } = await cDirectora.storage.from(BUCKET).list(centro.id)
    expect(data ?? []).toEqual([])
    // El barrido es solo del servidor.
    expect((await cAdmin.rpc('ficheros_remesa_vencidos', { p_anios: ANIOS })).error?.code).toBe(
      '42501'
    )
  })

  it('a los años fiscales de su marca vence; espera a la retención; y su recibo no se borra mientras vive', async () => {
    const rc = await recibo()
    // Una marca de hace años (la de antes de R-1 de una remesa vieja): la versión es de esa marca.
    const marca = '2015-03-02T09:00:00.000Z'
    const rem = await remesaCon(rc, marca)
    const msgId = msgIdDe(rem, '20150302090000')
    await subir(rutaDe(rem, msgId))
    const r = await registrar(cDirectora, { remesa: rem, marca, msgId, adeudos: [adeudo(rc)] })
    expect(r.error).toBeNull()

    const vencidos = async () =>
      ((await serviceClient.rpc('ficheros_remesa_vencidos', { p_anios: ANIOS })).data ?? []).map(
        (v) => v.ruta
      )
    // Premisa: vencido.
    expect(await vencidos()).toContain(rutaDe(rem, msgId))

    // El recibo de un fichero vivo no se borra.
    const borrar = await serviceClient.from('recibos_remesa').delete().eq('remesa_id', rem)
    expect(borrar.error).toBeNull()
    const delRecibo = await serviceClient.from('recibos').delete().eq('id', rc)
    expect(delRecibo.error?.code).toBe('23503')

    // Retenido el tutor de la familia, el fichero espera.
    const poner = await cAdmin.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo: 'usuario', id: tutor.id }] as never,
      p_motivo_tipo: 'juzgado',
      p_motivo: 'Requerimiento del juzgado de prueba',
    })
    expect(poner.error).toBeNull()
    expect(await vencidos()).not.toContain(rutaDe(rem, msgId))
    const { data: f } = await cDirectora.rpc('fichero_remesa_vigente', { p_remesa_id: rem })
    const quieto = await serviceClient.rpc('destruir_fichero_remesa', {
      p_fichero_id: f![0].fichero_id,
      p_anios: ANIOS,
    })
    expect(quieto.data).toBeNull()

    // Quitada, se destruye con sus adeudos.
    const quitar = await cAdmin.rpc('quitar_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [{ tipo: 'usuario', id: tutor.id }] as never,
      p_motivo: 'Archivado el procedimiento de prueba',
    })
    expect(quitar.error).toBeNull()
    const destruido = await serviceClient.rpc('destruir_fichero_remesa', {
      p_fichero_id: f![0].fichero_id,
      p_anios: ANIOS,
    })
    expect(destruido.error).toBeNull()
    expect(destruido.data).toBe(1)
    expect((await cDirectora.rpc('fichero_remesa_vigente', { p_remesa_id: rem })).data).toEqual([])
  })

  it('un fichero de hoy no vence', async () => {
    const rc = await recibo()
    const rem = await remesaCon(rc)
    const marca = ahora()
    const msgId = msgIdDe(rem, '20260301000007')
    await subir(rutaDe(rem, msgId))
    expect(
      (await registrar(cDirectora, { remesa: rem, marca, msgId, adeudos: [adeudo(rc)] })).error
    ).toBeNull()
    const { data } = await serviceClient.rpc('ficheros_remesa_vencidos', { p_anios: ANIOS })
    expect((data ?? []).map((v) => v.ruta)).not.toContain(rutaDe(rem, msgId))
  })
})
