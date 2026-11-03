import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
import { enviadaAtDelFichero, insertarRecibos } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { borrarMandatos, insertarMandato } from './mandatos-como-postgres'

/**
 * Marcar enviada exige el fichero guardado (R-4, `20261221120000`), contra la BD real.
 *
 *  - La marca del fichero solo la pone `registrar_fichero_remesa`, y la remesa solo pasa a enviada
 *    por `marcar_remesa_enviada`: por UPDATE o INSERT directos, ni la sesión de Dirección ni
 *    service_role (decisión del responsable del 2026-11-02).
 *  - Sin el fichero de su versión, no se marca (`sin_fichero`). Si los recibos cobrables ya no son
 *    los del fichero (uno borrado después de descargarlo), tampoco (`fichero_no_coincide`).
 *  - Marcada, pasan a enviado_banco solo los recibos del fichero, con la fecha de Madrid, y el
 *    fichero queda con su `enviada_at`. Una vez; la segunda, `ya_enviada`.
 *  - La profe, otro centro y anon, nada.
 */

const BUCKET = 'remesas-ficheros'
const MNDT = 'NIDO-RENV-0001'

describe('Marcar enviada exige el fichero (R-4)', () => {
  let centro: { id: string }
  let otroCentro: { id: string }
  let familia: string
  let directora: TestUser
  let directoraOtro: TestUser
  let profe: TestUser
  let tutor: TestUser
  let cDirectora: SupabaseClient<Database>
  let cDirectoraOtro: SupabaseClient<Database>
  let cProfe: SupabaseClient<Database>
  let segundo = 0

  async function recibo(
    over: Partial<Database['public']['Tables']['recibos']['Insert']> = {}
  ): Promise<string> {
    const [id] = await insertarRecibos([
      {
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 4,
        estado: 'pendiente_procesar',
        metodo: 'sepa',
        total_centimos: 10000,
        es_esporadico: true,
        concepto_esporadico: 'Marcar enviada',
        ...over,
      },
    ])
    return id
  }

  /** Una remesa en borrador con esos recibos: los cobrables los enlaza Dirección; el resto, el servidor. */
  async function remesaCon(cobrables: string[], otros: string[] = []): Promise<string> {
    const { data, error } = await cDirectora
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2026, mes: 4 })
      .select('id')
      .single()
    if (error || !data) throw new Error(`remesa: ${error?.message}`)
    for (const rc of cobrables) {
      const e = await cDirectora
        .from('recibos_remesa')
        .insert({ centro_id: centro.id, remesa_id: data.id, recibo_id: rc })
      if (e.error) throw new Error(`enlace: ${e.error.message}`)
    }
    for (const rc of otros) {
      const e = await serviceClient
        .from('recibos_remesa')
        .insert({ centro_id: centro.id, remesa_id: data.id, recibo_id: rc })
      if (e.error) throw new Error(`enlace del servidor: ${e.error.message}`)
    }
    return data.id
  }

  /** La descarga: sube el fichero y lo registra con la sesión de Dirección y la marca de ahora. */
  async function descargar(remesa: string, cobrables: string[]): Promise<void> {
    const d = new Date()
    d.setUTCMilliseconds(0)
    const marca = d.toISOString()
    segundo += 1
    const msgId = `NIDO-${remesa.slice(0, 8)}-2026040100${String(segundo).padStart(4, '0')}`
    const ruta = `${centro.id}/${remesa}/${msgId}.xml`
    const up = await serviceClient.storage
      .from(BUCKET)
      .upload(ruta, '<Document/>', { contentType: 'application/xml', upsert: false })
    if (up.error) throw new Error(`subir: ${up.error.message}`)
    const r = await cDirectora.rpc('registrar_fichero_remesa', {
      p_remesa_id: remesa,
      p_marca: marca,
      p_msg_id: msgId,
      p_sha256: 'a'.repeat(64),
      p_ruta: ruta,
      p_adeudos: cobrables.map((rc) => ({
        recibo_id: rc,
        end_to_end_id: rc.replace(/-/g, '').toUpperCase(),
        importe_centimos: 10000,
        mndt_id: MNDT,
      })) as never,
    })
    if (r.error) throw new Error(`registrar: ${r.error.message} (${r.error.hint})`)
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

  beforeAll(async () => {
    centro = await createTestCentro('Centro Marcar Enviada')
    otroCentro = await createTestCentro('Otro Centro Marcar Enviada')
    familia = await createTestFamilia(centro.id)
    directora = await createTestUser({ nombre: 'Directora Marcar Enviada' })
    directoraOtro = await createTestUser({ nombre: 'Directora Otra Marcar Enviada' })
    profe = await createTestUser({ nombre: 'Profe Marcar Enviada' })
    tutor = await createTestUser({ nombre: 'Tutor Marcar Enviada' })
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(directoraOtro.id, otroCentro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cDirectora = await clientFor(directora)
    cDirectoraOtro = await clientFor(directoraOtro)
    cProfe = await clientFor(profe)
    const { error } = insertarMandato({
      centro_id: centro.id,
      familia_id: familia,
      usuario_id: tutor.id,
      iban_cifrado: '\\x00',
      titular: 'Tutor Marcar Enviada',
      identificador_mandato: MNDT,
      estado: 'activo',
    })
    if (error) throw new Error(`mandato: ${error.message}`)
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
    for (const c of [centro, otroCentro]) {
      await serviceClient.from('recibos_remesa').delete().eq('centro_id', c.id)
      await serviceClient.from('remesas').delete().eq('centro_id', c.id)
      await serviceClient.from('recibos').delete().eq('centro_id', c.id)
      borrarMandatos('centro_id', c.id)
      await deleteTestCentro(c.id)
    }
    for (const u of [directora, directoraOtro, profe, tutor]) await deleteTestUser(u.id)
  }, 180_000)

  it('la marca no se pone por fuera de su registro: ni Dirección ni service_role, ni al crear', async () => {
    const rc = await recibo()
    const rem = await remesaCon([rc])
    // Premisa: la remesa existe, en borrador y sin marca, y Dirección la puede actualizar.
    expect(await remesaDe(rem)).toMatchObject({ estado: 'borrador', fichero_generado_at: null })
    const toca = await cDirectora
      .from('remesas')
      .update({ fecha_envio_banco: null })
      .eq('id', rem)
      .select('id')
      .maybeSingle()
    expect(toca.data).not.toBeNull()

    const sesion = await cDirectora
      .from('remesas')
      .update({ fichero_generado_at: new Date().toISOString() })
      .eq('id', rem)
    expect(sesion.error?.hint).toBe('marca_solo_registro')
    const servicio = await serviceClient
      .from('remesas')
      .update({ fichero_generado_at: new Date().toISOString() })
      .eq('id', rem)
    expect(servicio.error?.hint).toBe('marca_solo_registro')
    const alCrear = await cDirectora.from('remesas').insert({
      centro_id: centro.id,
      anio: 2026,
      mes: 4,
      fichero_generado_at: new Date().toISOString(),
    })
    expect(alCrear.error?.hint).toBe('marca_solo_registro')
    expect((await remesaDe(rem))?.fichero_generado_at).toBeNull()

    // Su registro sí la pone.
    await descargar(rem, [rc])
    expect((await remesaDe(rem))?.fichero_generado_at).not.toBeNull()
  })

  it('la remesa no pasa a enviada por fuera de su función: ni Dirección ni service_role, ni al crear', async () => {
    const rc = await recibo()
    const rem = await remesaCon([rc])
    await descargar(rem, [rc])

    const sesion = await cDirectora
      .from('remesas')
      .update({ estado: 'enviada', fecha_envio_banco: '2026-04-02' })
      .eq('id', rem)
    expect(sesion.error?.hint).toBe('enviada_solo_por_marcar')
    const servicio = await serviceClient
      .from('remesas')
      .update({ estado: 'enviada', fecha_envio_banco: '2026-04-02' })
      .eq('id', rem)
    expect(servicio.error?.hint).toBe('enviada_solo_por_marcar')
    const alCrear = await cDirectora
      .from('remesas')
      .insert({ centro_id: centro.id, anio: 2026, mes: 4, estado: 'enviada' })
    expect(alCrear.error?.hint).toBe('enviada_solo_por_marcar')
    expect((await remesaDe(rem))?.estado).toBe('borrador')
  })

  it('sin el fichero descargado no se marca, y lo dice', async () => {
    const rc = await recibo()
    const rem = await remesaCon([rc])
    const r = await cDirectora.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.hint).toBe('sin_fichero')
    expect((await remesaDe(rem))?.estado).toBe('borrador')
    expect((await estados([rc]))[rc]).toBe('pendiente_procesar/null')
  })

  it('con el fichero: pasan a enviado_banco solo sus recibos, con la fecha de Madrid; una vez', async () => {
    const a = await recibo()
    const b = await recibo()
    // Un recibo de la remesa que no es cobrable (por banco no, en efectivo) no va en el fichero.
    const fuera = await recibo({ metodo: 'efectivo' })
    const rem = await remesaCon([a, b], [fuera])
    await descargar(rem, [a, b])
    // Premisa: el fichero está, sin enviar, y los tres recibos pendientes.
    expect(enviadaAtDelFichero(rem)).toBeNull()
    expect(await estados([a, b, fuera])).toEqual({
      [a]: 'pendiente_procesar/null',
      [b]: 'pendiente_procesar/null',
      [fuera]: 'pendiente_procesar/null',
    })

    const hoy = (await cDirectora.rpc('hoy_madrid')).data as string
    const r = await cDirectora.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    expect(r.error).toBeNull()
    expect(r.data).toBe(2)
    expect(await remesaDe(rem)).toMatchObject({ estado: 'enviada', fecha_envio_banco: hoy })
    expect(await estados([a, b, fuera])).toEqual({
      [a]: `enviado_banco/${hoy}`,
      [b]: `enviado_banco/${hoy}`,
      [fuera]: 'pendiente_procesar/null',
    })
    expect(enviadaAtDelFichero(rem)).not.toBeNull()

    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('usuario_id, valores_despues')
      .eq('tabla', 'remesas')
      .eq('registro_id', rem)
      .eq('accion', 'UPDATE')
    expect(
      (audit ?? []).some(
        (f) =>
          f.usuario_id === directora.id &&
          (f.valores_despues as Record<string, unknown> | null)?.estado === 'enviada'
      )
    ).toBe(true)

    const otra = await cDirectora.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    expect(otra.error?.hint).toBe('ya_enviada')
  })

  it('si un recibo se borró después de descargar el fichero, no se marca y lo dice', async () => {
    const a = await recibo()
    const b = await recibo()
    const rem = await remesaCon([a, b])
    await descargar(rem, [a, b])
    // Dirección puede borrar un recibo de una remesa con el fichero ya descargado.
    const borrado = await cDirectora
      .from('recibos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', b)
      .select('id')
      .maybeSingle()
    expect(borrado.data).not.toBeNull()

    const r = await cDirectora.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    expect(r.error?.code).toBe('P0001')
    expect(r.error?.hint).toBe('fichero_no_coincide')
    expect((await remesaDe(rem))?.estado).toBe('borrador')
    expect((await estados([a]))[a]).toBe('pendiente_procesar/null')
    expect(enviadaAtDelFichero(rem)).toBeNull()
  })

  it('la profe, la directora de otro centro y anon no marcan', async () => {
    const rc = await recibo()
    const rem = await remesaCon([rc])
    await descargar(rem, [rc])
    for (const c of [cProfe, cDirectoraOtro]) {
      const r = await c.rpc('marcar_remesa_enviada', { p_remesa_id: rem })
      expect(r.error?.code).toBe('42501')
    }
    const a = await anonClient().rpc('marcar_remesa_enviada', { p_remesa_id: rem })
    expect(a.error?.code).toBe('42501')
    expect((await remesaDe(rem))?.estado).toBe('borrador')
  })
})
