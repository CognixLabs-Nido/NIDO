import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  CID_PRUEBA,
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
import {
  actualizarMandato,
  borrarMandatos,
  insertarMandato,
  insertarMandatoV1Existente,
} from './mandatos-como-postgres'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * El mandato v2 (`20261229120000`, 0c-1), contra la BD real.
 *
 *  - Sin CID del centro no se firma ningún mandato: registrar y sustituir lo rechazan
 *    (`centro_sin_cid`), para la directora y para el tutor. Quien no está autorizado sigue
 *    recibiendo «No autorizado»: no sabe si el centro tiene CID.
 *  - Con CID, la llamada con los datos nuevos da un v2 que guarda el documento y la dirección del
 *    titular y la foto del acreedor con la que se firmó. Sin ellos daba un v1 hasta
 *    `20261230120000`, que lo cierra (`mandato-v1-cerrado.rls.test.ts`).
 *  - Un v2 lleva todo, el CID y el nombre del centro de verdad y el hash en hexadecimal; el CHECK
 *    lo exige también a quien escribe la tabla directamente.
 *  - El documento y la dirección del titular no entran en audit_log y sí en el export.
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
    p_titular: 'Titular Prueba V2',
    p_identificador_mandato: `NIDO-V2TEST-${n}`,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: 'Titular Prueba V2',
    p_texto_hash: HASH,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: '2026-11-04T10:00:00Z',
    p_metodo: 'presencial',
    ...extra,
  } as never
}

describe('El mandato v2 y el CID obligatorio', () => {
  let conCid: { id: string; nombre: string }
  let sinCid: { id: string; nombre: string }
  let admin: TestUser
  let tutor: TestUser
  let ajeno: TestUser
  let cAdmin: Cliente
  let cTutor: Cliente
  let cAjeno: Cliente
  // Una familia por caso que escribe: así un mandato de un caso no cambia lo que mide el otro.
  async function familia(centro: string, conTutor = false): Promise<string> {
    const f = await createTestFamilia(centro)
    if (conTutor) await crearFamiliaTutor(f, tutor.id, 'titular')
    return f
  }
  function v2(centroNombre: string, cambios: Record<string, unknown> = {}) {
    return {
      p_titular_documento: 'X1234567L',
      p_titular_direccion: 'Calle Prueba 1, Valencia',
      p_acreedor_cid: CID_PRUEBA,
      p_acreedor_nombre: centroNombre,
      ...cambios,
    }
  }
  async function mandatosDe(fam: string) {
    const { data } = await serviceClient
      .from('mandatos_sepa')
      .select(
        'id, estado, version_canonico, titular_documento, titular_direccion, acreedor_cid, acreedor_nombre'
      )
      .eq('familia_id', fam)
      .order('created_at')
    return data ?? []
  }

  beforeAll(async () => {
    conCid = await createTestCentro('Centro Con CID V2')
    sinCid = await createTestCentro('Centro Sin CID V2', { sinCid: true })
    admin = await createTestUser({ nombre: 'Admin Mandato V2' })
    tutor = await createTestUser({ nombre: 'Tutor Mandato V2' })
    ajeno = await createTestUser({ nombre: 'Ajeno Mandato V2' })
    for (const c of [conCid.id, sinCid.id]) await asignarRol(admin.id, c, 'admin')
    await asignarRol(tutor.id, sinCid.id, 'tutor_legal')
    cAdmin = await clientFor(admin)
    cTutor = await clientFor(tutor)
    cAjeno = await clientFor(ajeno)
  }, 120_000)

  afterAll(async () => {
    for (const c of [conCid, sinCid]) borrarMandatos('centro_id', c.id)
    for (const c of [conCid, sinCid]) await deleteTestCentro(c.id)
    for (const u of [admin, tutor, ajeno]) await deleteTestUser(u.id)
  }, 120_000)

  it('sin CID del centro no se firma ningún mandato, ni la directora ni el tutor', async () => {
    // Premisas: un centro tiene CID y el otro no.
    const { data: centros } = await serviceClient
      .from('centros')
      .select('id, identificador_acreedor')
      .in('id', [conCid.id, sinCid.id])
    const cid = new Map((centros ?? []).map((c) => [c.id, c.identificador_acreedor]))
    expect(cid.get(conCid.id)).toBe(CID_PRUEBA)
    expect(cid.get(sinCid.id)).toBeNull()

    const famSin = await familia(sinCid.id, true)
    for (const [quien, c] of [
      ['directora', cAdmin],
      ['tutor', cTutor],
    ] as const) {
      for (const fn of ['registrar_mandato_sepa', 'sustituir_mandato_sepa'] as const) {
        const r = await c.rpc(fn, args(famSin, IBAN_1))
        expect.soft(r.error?.hint, `${quien} ${fn} v1`).toBe('centro_sin_cid')
        const r2 = await c.rpc(fn, args(famSin, IBAN_1, v2(sinCid.nombre)))
        expect.soft(r2.error?.hint, `${quien} ${fn} v2`).toBe('centro_sin_cid')
      }
    }
    expect(await mandatosDe(famSin)).toEqual([])

    // Quien no está autorizado no se entera de si hay CID.
    const r = await cAjeno.rpc('registrar_mandato_sepa', args(famSin, IBAN_1))
    expect(r.error?.message).toMatch(/No autorizado/)
    expect(r.error?.hint ?? null).toBeNull()

    // Control positivo: la misma llamada con los datos del v2, en el centro con CID, firma.
    const famCon = await familia(conCid.id)
    const ok = await cAdmin.rpc('registrar_mandato_sepa', args(famCon, IBAN_1, v2(conCid.nombre)))
    expect(ok.error).toBeNull()
    expect(await mandatosDe(famCon)).toHaveLength(1)
  })

  it('con CID, la llamada del 0c-2 da un v2 con sus datos', async () => {
    const famV2 = await familia(conCid.id)
    const r2 = await cAdmin.rpc('registrar_mandato_sepa', args(famV2, IBAN_1, v2(conCid.nombre)))
    expect(r2.error).toBeNull()
    const datos = {
      version_canonico: 2,
      titular_documento: 'X1234567L',
      titular_direccion: 'Calle Prueba 1, Valencia',
      acreedor_cid: CID_PRUEBA,
      acreedor_nombre: conCid.nombre,
    }
    expect(await mandatosDe(famV2)).toEqual([
      expect.objectContaining({ ...datos, estado: 'activo' }),
    ])

    // Sustituir con otro IBAN: el v2 nuevo activo y el anterior revocado, con lo suyo.
    const r3 = await cAdmin.rpc('sustituir_mandato_sepa', args(famV2, IBAN_2, v2(conCid.nombre)))
    expect(r3.error).toBeNull()
    expect(await mandatosDe(famV2)).toEqual([
      expect.objectContaining({ ...datos, estado: 'revocado' }),
      expect.objectContaining({ ...datos, estado: 'activo' }),
    ])
  })

  it('un v2 lleva todo, el CID y el nombre del centro y el hash en hexadecimal', async () => {
    const fam = await familia(conCid.id)
    for (const [caso, cambios, hint] of [
      ['otro CID', v2(conCid.nombre, { p_acreedor_cid: 'ES80ZZZB00000000' }), 'cid_distinto'],
      [
        'otro acreedor',
        v2(conCid.nombre, { p_acreedor_nombre: 'Otro Centro' }),
        'acreedor_distinto',
      ],
      [
        'sin documento',
        v2(conCid.nombre, { p_titular_documento: undefined }),
        'mandato_incompleto',
      ],
      [
        'sin dirección',
        v2(conCid.nombre, { p_titular_direccion: undefined }),
        'mandato_incompleto',
      ],
      [
        'dirección en blanco',
        v2(conCid.nombre, { p_titular_direccion: '   ' }),
        'mandato_incompleto',
      ],
      ['sin CID', v2(conCid.nombre, { p_acreedor_cid: undefined }), 'mandato_incompleto'],
      ['sin hash', { ...v2(conCid.nombre), p_texto_hash: null }, 'hash_invalido'],
      [
        'hash que no es hex',
        { ...v2(conCid.nombre), p_texto_hash: 'Z'.repeat(64) },
        'hash_invalido',
      ],
    ] as const) {
      for (const fn of ['registrar_mandato_sepa', 'sustituir_mandato_sepa'] as const) {
        const r = await cAdmin.rpc(fn, args(fam, IBAN_1, cambios))
        expect.soft(r.error?.hint, `${fn} ${caso}`).toBe(hint)
      }
    }
    expect(await mandatosDe(fam)).toEqual([])
  })

  it('el CHECK exige lo mismo a quien escribe la tabla directamente', async () => {
    const fam = await familia(conCid.id)
    const base = {
      centro_id: conCid.id,
      familia_id: fam,
      usuario_id: admin.id,
      titular: 'Titular Prueba V2',
      iban_cifrado: '\\x00',
      metodo_firma: 'presencial',
    }
    const datos = {
      titular_documento: 'X1234567L',
      titular_direccion: 'Calle Prueba 1',
      acreedor_cid: CID_PRUEBA,
      acreedor_nombre: conCid.nombre,
    }
    // Control positivo: un v2 completo entra.
    const ok = insertarMandato({
      ...base,
      identificador_mandato: 'NIDO-V2TEST-CHECK-OK',
      texto_hash: HASH,
      version_canonico: 2,
      ...datos,
    })
    expect(ok.error).toBeNull()
    for (const [caso, fila] of [
      ['v2 sin hash', { version_canonico: 2, texto_hash: null, ...datos }],
      [
        'v2 sin dirección',
        { version_canonico: 2, texto_hash: HASH, ...datos, titular_direccion: null },
      ],
      ['versión 3', { version_canonico: 3, texto_hash: HASH, ...datos }],
    ] as const) {
      const r = insertarMandato({ ...base, identificador_mandato: `NIDO-V2TEST-${caso}`, ...fila })
      expect.soft(r.error?.code, caso).toBe('23514')
    }
    // Un v1 de los que ya existían tampoco lleva los datos del v2 (con el trigger del 0c-3 apagado
    // para crearlo: el CHECK sigue).
    const v1 = insertarMandatoV1Existente({
      ...base,
      identificador_mandato: 'NIDO-V2TEST-v1 con documento',
      texto_hash: HASH,
      titular_documento: 'X1234567L',
    })
    expect(v1.error?.code).toBe('23514')
    // Y al cambiarlo: el v2 bueno no pierde su hash.
    const u = actualizarMandato(ok.data!.id, { texto_hash: null })
    expect(u.error?.code).toBe('23514')
  })

  it('el documento y la dirección del titular quedan fuera de audit_log y salen en el export', async () => {
    const fam = await familia(conCid.id, true)
    // Lo firma el tutor (digital), para pedir después su propio export.
    await asignarRol(tutor.id, conCid.id, 'tutor_legal')
    const r = await cTutor.rpc(
      'registrar_mandato_sepa',
      args(fam, IBAN_1, { p_metodo: 'digital', ...v2(conCid.nombre) })
    )
    expect(r.error).toBeNull()
    const id = r.data as unknown as string

    const { data: audit } = await serviceClient
      .from('audit_log')
      .select('valores_despues')
      .eq('tabla', 'mandatos_sepa')
      .eq('registro_id', id)
    // Premisa: el alta del mandato está auditada (si no, «no está» no diría nada).
    expect(audit).toHaveLength(1)
    const fila = audit![0]!.valores_despues as Record<string, unknown>
    expect(fila).toMatchObject({ version_canonico: 2, acreedor_cid: CID_PRUEBA })
    for (const k of ['titular_documento', 'titular_direccion', 'titular', 'iban_cifrado']) {
      expect.soft(fila, k).not.toHaveProperty(k)
    }

    const ex = await cTutor.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'usuario',
      p_sujeto_id: tutor.id,
    })
    expect(ex.error).toBeNull()
    const mandatos = ((ex.data as Record<string, unknown>).mandatos_sepa ?? []) as Record<
      string,
      unknown
    >[]
    expect(mandatos).toContainEqual(
      expect.objectContaining({
        identificador_mandato: expect.stringMatching(/^NIDO-V2TEST-/),
        version_canonico: 2,
        titular_documento: 'X1234567L',
        titular_direccion: 'Calle Prueba 1, Valencia',
        acreedor_cid: CID_PRUEBA,
        acreedor_nombre: conCid.nombre,
      })
    )
  })
})
