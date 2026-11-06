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
import { borrarMandatos, insertarMandato } from './mandatos-como-postgres'
import {
  ficherosDeLaRemesa,
  insertarRecibos,
  marcarEnviadaComoLaFuncion,
} from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import { messageIdRemesa } from '@/features/remesas/lib/message-id'
import type { Database } from '@/types/database'

/**
 * Borrar una remesa (`20261228120000`), contra la BD real.
 *
 *  - Lo que se cerró: una remesa con historia no desaparece de la app, para nadie, tampoco con
 *    service_role. Ni la enviada (`remesa_cerrada`), ni la que tiene la marca de su descarga
 *    (`remesa_con_fichero`), ni la reabierta, que vuelve a borrador sin la marca pero conserva el
 *    fichero de su versión anterior (`remesa_con_historia`).
 *  - Lo que sigue: el soft delete de un borrador que nunca tuvo fichero (el rollback de
 *    crearRemesa), con sesión y con service_role; y el DELETE, que este cambio no toca: el de la
 *    remesa vacía que hace la destrucción fiscal y el del borrado de un centro. Con fichero, la FK
 *    RESTRICT de remesa_ficheros lo impide, como antes.
 *
 * Lo medido antes de construir (ensayo en producción, 2026-11-04): borrar una remesa no deja su
 * fichero huérfano, porque el barrido de retención lo busca por su fecha y no por su remesa. El
 * cierre no es por eso, sino para que la remesa no desaparezca de la app con su historia.
 */

const BUCKET = 'remesas-ficheros'
const MNDT = 'NIDO-BORR-000A'

describe('Borrar una remesa', () => {
  let centro: { id: string }
  let familia: string
  let admin: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let segundo = 0

  async function recibo(): Promise<string> {
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
        concepto_esporadico: 'Borrar remesa',
      },
    ])
    return id
  }

  async function remesaCon(recibos: readonly string[]): Promise<string> {
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

  /** La descarga: sube el fichero y lo registra con la sesión de la admin. */
  async function descargar(remesa: string, recibos: string[]): Promise<void> {
    segundo += 1
    const d = new Date()
    d.setUTCMilliseconds(0)
    d.setUTCSeconds(d.getUTCSeconds() + segundo)
    const msgId = messageIdRemesa(remesa, d.toISOString())
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
        mndt_id: MNDT,
      })) as never,
    })
    if (r.error) throw new Error(`registrar: ${r.error.message} (${r.error.hint})`)
  }

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
      .select('estado, fichero_generado_at, deleted_at')
      .eq('id', id)
      .maybeSingle()
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Borrar Remesa')
    familia = await createTestFamilia(centro.id)
    admin = await createTestUser({ nombre: 'Admin Borrar Remesa' })
    tutor = await createTestUser({ nombre: 'Tutor Borrar Remesa' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cAdmin = await clientFor(admin)
    const { error } = insertarMandato({
      centro_id: centro.id,
      familia_id: familia,
      usuario_id: tutor.id,
      iban_cifrado: '\\x00',
      titular: 'Tutor Borrar Remesa',
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
    // Los registros de hoy no vencen y sujetan sus remesas (RESTRICT): se quedan en la BD efímera.
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centro.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, tutor]) await deleteTestUser(u.id)
  }, 180_000)

  it('una remesa con historia no se borra, tampoco con service_role', async () => {
    for (const [quien, c] of [
      ['service_role', serviceClient],
      ['admin', cAdmin],
    ] as const) {
      // Cada uno con sus remesas: si las compartieran, la que borrara el primero ya no mediría al
      // segundo.
      const enviada = await enviadaCon([await recibo()])
      const rm = await recibo()
      const conMarca = await remesaCon([rm])
      await descargar(conMarca, [rm])
      const reabierta = await enviadaCon([await recibo()])
      const r = await cAdmin.rpc('reabrir_remesa', {
        p_remesa_id: reabierta,
        p_n_recibos: 1,
        p_total_centimos: 10000,
      })
      if (r.error) throw new Error(`reabrir: ${r.error.message} (${r.error.hint})`)
      // Premisas: la reabierta está en borrador y sin marca, pero con el fichero de su versión; y
      // quien prueba escribe la fila (un cambio que no es borrar pasa).
      expect.soft(await remesaDe(reabierta), `${quien} reabierta`).toMatchObject({
        estado: 'borrador',
        fichero_generado_at: null,
      })
      expect.soft(ficherosDeLaRemesa(reabierta), `${quien} fichero`).toHaveLength(1)
      const toca = await c
        .from('remesas')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', reabierta)
        .select('id')
      expect.soft(toca.data, `${quien} premisa`).toHaveLength(1)

      for (const [caso, id, hint] of [
        ['enviada', enviada, 'remesa_cerrada'],
        ['con marca', conMarca, 'remesa_con_fichero'],
        ['reabierta', reabierta, 'remesa_con_historia'],
      ] as const) {
        const b = await c
          .from('remesas')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id)
        expect.soft(b.error?.hint, `${quien} ${caso}`).toBe(hint)
        expect.soft((await remesaDe(id))?.deleted_at, `${quien} ${caso} sigue viva`).toBeNull()
      }
    }
  })

  it('un borrador que nunca tuvo fichero se borra, con sesión y con service_role', async () => {
    for (const [quien, c] of [
      ['service_role', serviceClient],
      ['admin', cAdmin],
    ] as const) {
      // El rollback de crearRemesa: la recién creada, sin enlaces; y un borrador con un recibo.
      for (const [caso, recibos] of [
        ['vacía', [] as string[]],
        ['con un recibo', [await recibo()]],
      ] as const) {
        const id = await remesaCon(recibos)
        const b = await c
          .from('remesas')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id)
          .select('id')
        expect.soft(b.error, `${quien} ${caso}`).toBeNull()
        expect.soft(b.data, `${quien} ${caso}`).toHaveLength(1)
        expect.soft((await remesaDe(id))?.deleted_at, `${quien} ${caso} borrada`).not.toBeNull()
      }
    }
  })

  it('el DELETE no cambia: la vacía se borra (lo fiscal), la que tuvo fichero no (la FK)', async () => {
    // La enviada sin fichero, como la de CEI Ejemplo: vaciada, el DELETE pasa.
    const sinFichero = await remesaCon([await recibo()])
    marcarEnviadaComoLaFuncion(sinFichero, '2026-05-02')
    expect((await remesaDe(sinFichero))?.estado).toBe('enviada')
    await serviceClient.from('recibos_remesa').delete().eq('remesa_id', sinFichero)
    const d1 = await serviceClient.from('remesas').delete().eq('id', sinFichero).select('id')
    expect.soft(d1.error).toBeNull()
    expect.soft(d1.data).toHaveLength(1)
    expect.soft(await remesaDe(sinFichero)).toBeNull()

    // Con su fichero vivo, la FK RESTRICT de remesa_ficheros no deja.
    const conFichero = await enviadaCon([await recibo()])
    await serviceClient.from('recibos_remesa').delete().eq('remesa_id', conFichero)
    const d2 = await serviceClient.from('remesas').delete().eq('id', conFichero)
    expect.soft(d2.error?.code).toBe('23503')
    expect.soft(await remesaDe(conFichero)).not.toBeNull()
  })

  it('borrar un centro se lleva sus remesas, también la enviada', async () => {
    const otro = await createTestCentro('Centro Borrar Remesa Desechable')
    const ids: string[] = []
    for (const mes of [5, 6]) {
      const { data, error } = await serviceClient
        .from('remesas')
        .insert({ centro_id: otro.id, anio: 2026, mes })
        .select('id')
        .single()
      if (error || !data) throw new Error(`remesa: ${error?.message}`)
      ids.push(data.id)
    }
    marcarEnviadaComoLaFuncion(ids[1]!, '2026-06-02')
    // Premisa: el centro tiene un borrador y una enviada.
    const { data: antes } = await serviceClient
      .from('remesas')
      .select('estado')
      .eq('centro_id', otro.id)
    expect((antes ?? []).map((r) => r.estado).sort()).toEqual(['borrador', 'enviada'])
    const d = await serviceClient.from('centros').delete().eq('id', otro.id)
    expect(d.error).toBeNull()
    const { data: despues } = await serviceClient.from('remesas').select('id').in('id', ids)
    expect(despues).toEqual([])
  })
})
