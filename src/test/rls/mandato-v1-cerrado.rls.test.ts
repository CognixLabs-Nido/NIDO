import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  CID_PRUEBA,
  clientFor,
  crearFamiliaTutor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  datosMandatoV2,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'
import {
  actualizarMandato,
  borrarMandatos,
  insertarMandato,
  insertarMandatoV1Existente,
} from './mandatos-como-postgres'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * No se firman mandatos v1 nuevos (`20261230120000`, 0c-3), contra la BD real.
 *
 *  - registrar y sustituir sin los datos del v2 dan `v1_cerrado`, para la directora y para el tutor,
 *    sin escribir nada: en sustituir, el activo de la familia sigue activo.
 *  - Por la tabla, como postgres (el SQL Editor), un v1 no entra y uno existente no se vuelve a
 *    firmar como v1 (`v1_solo_existentes`). Los dos HINT son distintos a propósito: así se ve cuál
 *    de las dos defensas rechaza, y quitar una de las dos pone rojo su caso.
 *  - Los v1 que ya existen se quedan: se revocan al sustituirlos por un v2, se revocan a mano, y el
 *    reintento del alta los vuelve a firmar en su sitio como v2.
 */

const IBAN_1 = 'ES7620770024003102575766'
const IBAN_2 = 'ES9121000418450200051332'
const HASH = 'a'.repeat(64)

type Cliente = SupabaseClient<Database>

let n = 0
function args(familia: string, iban: string, extra: Record<string, unknown> = {}) {
  n += 1
  return {
    p_familia_id: familia,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Titular Prueba V1',
    p_identificador_mandato: `NIDO-V1C-${n}`,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: 'Titular Prueba V1',
    p_texto_hash: HASH,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: '2026-11-04T10:00:00Z',
    p_metodo: 'presencial',
    ...extra,
  } as never
}

describe('Los mandatos v1: los que existen se quedan, no se crean nuevos', () => {
  let centro: TestCentro
  let admin: TestUser
  let cAdmin: Cliente
  // Un adulto es de una sola familia por centro (ux_familia_tutores_usuario_centro): cada familia
  // que firma como tutor lleva el suyo.
  const tutores: TestUser[] = []

  async function familia(): Promise<string> {
    return createTestFamilia(centro.id)
  }
  async function familiaConTutor(): Promise<{ fam: string; cTutor: Cliente }> {
    const fam = await createTestFamilia(centro.id)
    const tutor = await createTestUser({ nombre: `Tutor Mandato V1 ${tutores.length + 1}` })
    tutores.push(tutor)
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearFamiliaTutor(fam, tutor.id, 'titular')
    return { fam, cTutor: await clientFor(tutor) }
  }
  /** Un v1 de los que ya existían, activo, de la familia dada. */
  function v1Existente(fam: string, iban?: string): string {
    const r = insertarMandatoV1Existente(
      {
        centro_id: centro.id,
        familia_id: fam,
        usuario_id: admin.id,
        titular: 'Titular Prueba V1',
        iban_cifrado: '\\x00',
        iban_ultimos4: '5766',
        metodo_firma: 'digital',
        identificador_mandato: `NIDO-V1C-EXISTENTE-${(n += 1)}`,
        estado: 'activo',
        texto_hash: HASH,
        fecha_firma: '2026-10-01T10:00:00Z',
      },
      { iban }
    )
    if (r.error) throw new Error(`v1 existente: ${r.error.code} ${r.error.message}`)
    return r.data!.id
  }
  async function mandatosDe(fam: string) {
    const { data, error } = await serviceClient
      .from('mandatos_sepa')
      .select(
        'id, estado, version_canonico, texto_hash, titular_documento, acreedor_cid, iban_ultimos4'
      )
      .eq('familia_id', fam)
      .order('created_at')
    if (error) throw new Error(`mandatosDe: ${error.message}`)
    return data ?? []
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro V1 Cerrado')
    admin = await createTestUser({ nombre: 'Admin Mandato V1' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
  }, 120_000)

  afterAll(async () => {
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, ...tutores]) await deleteTestUser(u.id)
  }, 120_000)

  it('registrar y sustituir sin los datos del v2 dan v1_cerrado y no escriben nada', async () => {
    // Premisa: el centro tiene CID (sin él, el rechazo sería centro_sin_cid y no diría nada de esto).
    const { data: c } = await serviceClient
      .from('centros')
      .select('identificador_acreedor')
      .eq('id', centro.id)
      .single()
    expect(c?.identificador_acreedor).toBe(CID_PRUEBA)

    const nueva = await familiaConTutor()
    const conV1 = await familiaConTutor()
    const famNueva = nueva.fam
    const famConV1 = conV1.fam
    const v1 = v1Existente(famConV1)
    expect(await mandatosDe(famConV1)).toEqual([
      expect.objectContaining({ id: v1, estado: 'activo', version_canonico: 1 }),
    ])

    for (const [caso, fam, cTutor] of [
      ['familia sin mandato', famNueva, nueva.cTutor],
      ['familia con un v1 activo', famConV1, conV1.cTutor],
    ] as const) {
      for (const [quien, cli] of [
        ['directora', cAdmin],
        ['tutor', cTutor],
      ] as const) {
        for (const fn of ['registrar_mandato_sepa', 'sustituir_mandato_sepa'] as const) {
          const r = await cli.rpc(fn, args(fam, IBAN_2))
          expect.soft(r.error?.hint, `${caso}: ${quien} ${fn}`).toBe('v1_cerrado')
          expect
            .soft(r.error?.message, `${caso}: ${quien} ${fn}`)
            .toMatch(/los que existen se quedan/)
        }
      }
    }
    expect(await mandatosDe(famNueva)).toEqual([])
    // sustituir rechaza antes de revocar: el v1 activo sigue activo.
    expect(await mandatosDe(famConV1)).toEqual([
      expect.objectContaining({ id: v1, estado: 'activo', version_canonico: 1 }),
    ])

    // Control positivo: la misma llamada con los datos del v2 firma.
    const ok = await cAdmin.rpc(
      'registrar_mandato_sepa',
      args(famNueva, IBAN_1, datosMandatoV2(centro))
    )
    expect(ok.error).toBeNull()
    expect(await mandatosDe(famNueva)).toEqual([
      expect.objectContaining({ estado: 'activo', version_canonico: 2, acreedor_cid: CID_PRUEBA }),
    ])
  })

  it('por la tabla, como postgres, un v1 no entra y uno existente no se vuelve a firmar como v1', async () => {
    const fam = await familia()
    const base = {
      centro_id: centro.id,
      familia_id: fam,
      usuario_id: admin.id,
      titular: 'Titular Prueba V1',
      iban_cifrado: '\\x00',
      metodo_firma: 'presencial',
      texto_hash: HASH,
    }
    // Control positivo: un v2 por la tabla entra.
    const v2 = insertarMandato({ ...base, identificador_mandato: 'NIDO-V1C-TABLA-V2' })
    expect(v2.error).toBeNull()

    // En otra familia, sin ningún mandato: lo único que puede pararlo es el trigger (en la del v2,
    // lo pararía también el índice de un activo por familia).
    const famLibre = await familia()
    const nuevo = insertarMandato({
      ...base,
      familia_id: famLibre,
      identificador_mandato: 'NIDO-V1C-TABLA-V1',
      version_canonico: 1,
    })
    expect(nuevo.error?.message).toMatch(/ya no se crean mandatos v1/)
    expect(nuevo.error?.code).toBe('P0001')

    // Un v2 no se vuelve v1.
    const aV1 = actualizarMandato(v2.data!.id, {
      version_canonico: 1,
      titular_documento: null,
      titular_direccion: null,
      acreedor_cid: null,
      acreedor_nombre: null,
    })
    expect(aV1.error?.message).toMatch(/no se vuelve a firmar como v1/)

    // Uno existente no cambia lo firmado.
    const famV1 = await familia()
    const v1 = v1Existente(famV1)
    for (const [caso, cambio] of [
      ['el hash', { texto_hash: 'b'.repeat(64) }],
      ['la fecha de firma', { fecha_firma: '2026-11-04T10:00:00Z' }],
      ['el titular', { titular: 'Otro Titular' }],
      ['el identificador', { identificador_mandato: 'NIDO-V1C-OTRO' }],
    ] as const) {
      const r = actualizarMandato(v1, cambio)
      expect.soft(r.error?.message, caso).toMatch(/no se vuelve a firmar como v1/)
    }
    expect(await mandatosDe(famV1)).toEqual([
      expect.objectContaining({ id: v1, estado: 'activo', texto_hash: HASH, version_canonico: 1 }),
    ])

    // Lo que no es firma sí cambia: revocarlo a mano.
    const rev = actualizarMandato(v1, { estado: 'revocado' })
    expect(rev.error).toBeNull()
    expect(await mandatosDe(famV1)).toEqual([
      expect.objectContaining({
        id: v1,
        estado: 'revocado',
        texto_hash: HASH,
        version_canonico: 1,
      }),
    ])
  })

  it('un v1 existente se sustituye por un v2 y se queda revocado como estaba', async () => {
    const fam = await familia()
    const v1 = v1Existente(fam)
    const r = await cAdmin.rpc('sustituir_mandato_sepa', args(fam, IBAN_2, datosMandatoV2(centro)))
    expect(r.error).toBeNull()
    expect(await mandatosDe(fam)).toEqual([
      expect.objectContaining({
        id: v1,
        estado: 'revocado',
        version_canonico: 1,
        texto_hash: HASH,
        titular_documento: null,
      }),
      expect.objectContaining({ estado: 'activo', version_canonico: 2, acreedor_cid: CID_PRUEBA }),
    ])
  })

  it('el reintento del alta sobre un v1 existente lo vuelve a firmar en su sitio como v2, no como v1', async () => {
    const { fam, cTutor } = await familiaConTutor()
    const v1 = v1Existente(fam, IBAN_1)
    // Como v1, no.
    const comoV1 = await cTutor.rpc('registrar_mandato_sepa', args(fam, IBAN_1))
    expect(comoV1.error?.hint).toBe('v1_cerrado')
    expect(await mandatosDe(fam)).toEqual([
      expect.objectContaining({ id: v1, version_canonico: 1, texto_hash: HASH }),
    ])
    // Como v2, sí: el mismo IBAN es el reintento (la misma fila), y ya es un v2.
    const comoV2 = await cTutor.rpc(
      'registrar_mandato_sepa',
      args(fam, IBAN_1, { ...datosMandatoV2(centro), p_texto_hash: 'c'.repeat(64) })
    )
    expect(comoV2.error).toBeNull()
    expect(await mandatosDe(fam)).toEqual([
      expect.objectContaining({
        id: v1,
        estado: 'activo',
        version_canonico: 2,
        texto_hash: 'c'.repeat(64),
        titular_documento: 'X1234567L',
        acreedor_cid: CID_PRUEBA,
      }),
    ])
  })
})
