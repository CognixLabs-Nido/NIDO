import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
  datosMandatoV2,
  type TestCentro,
} from './setup'
import { borrarMandatos } from './mandatos-como-postgres'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

/**
 * `mandatos_sepa` solo se escribe por sus funciones (`20261225120000`).
 *
 *  - Lo legítimo pasa: registrar (el tutor y, presencial, la admin) y sustituir, que deja el
 *    anterior `revocado`.
 *  - Nadie lo escribe directamente: ni el tutor ni la admin con su sesión, ni `service_role`. Cada
 *    operación (INSERT, UPDATE de cada columna, DELETE) da 42501 y el mandato queda igual.
 */

const IBAN_1 = 'ES7620770024003102575766'
const IBAN_2 = 'ES9121000418450200051332'

// Los datos del v2 del centro del fichero; sin ellos, la llamada da v1_cerrado (20261230120000).
let v2 = {} as ReturnType<typeof datosMandatoV2>

function argsMandato(familiaId: string, iban: string, id: string, metodo = 'digital') {
  return {
    p_familia_id: familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Titular Pruebas',
    p_identificador_mandato: id,
    p_documento_path: '',
    p_firma_imagen: '',
    p_nombre_tecleado: 'Titular Pruebas',
    p_texto_hash: 'a'.repeat(64),
    ...v2,
    p_ip_address: null,
    p_user_agent: 'test',
    p_fecha_firma: '2026-02-01T10:00:00Z',
    p_metodo: metodo,
  } as never
}

/**
 * Un valor distinto del que tiene, por columna: cada UPDATE intentaría cambiar algo. El del tutor
 * en `familia_id` lo rechaza también la RLS (no es tutor de la otra familia, y un adulto tiene una
 * familia por centro): esa columna la miden la admin y `service_role`.
 */
function cambios(otraFamilia: string, admin: string): Record<string, unknown> {
  return {
    estado: 'revocado',
    deleted_at: new Date().toISOString(),
    iban_cifrado: '\\x00',
    iban_ultimos4: '0000',
    titular: 'Otro Titular Pruebas',
    identificador_mandato: 'SOLO-FUNC-X',
    documento_path: null,
    firma_imagen: 'x',
    nombre_tecleado: 'Otro Titular Pruebas',
    texto_hash: 'b'.repeat(64),
    ip_address: '10.0.0.1',
    user_agent: 'otro',
    fecha_firma: '2020-01-01T00:00:00Z',
    metodo_firma: 'presencial',
    nino_id: null,
    usuario_id: admin,
    familia_id: otraFamilia,
    created_at: '2010-01-01T00:00:00Z',
    updated_at: '2010-01-01T00:00:00Z',
  }
}

describe('mandatos_sepa — solo por sus funciones', () => {
  let centro: TestCentro
  let familia: string
  let familiaB: string
  let admin: TestUser
  let tutor: TestUser
  let cAdmin: SupabaseClient<Database>
  let cTutor: SupabaseClient<Database>
  let mandatoId: string
  const usuariosExtra: TestUser[] = []

  async function leer(id: string) {
    const { data, error } = await serviceClient
      .from('mandatos_sepa')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw new Error(`leer mandato: ${error.message}`)
    return data
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Mandatos Solo Funciones')
    v2 = datosMandatoV2(centro)
    familia = await createTestFamilia(centro.id)
    familiaB = await createTestFamilia(centro.id)
    admin = await createTestUser({ nombre: 'Admin Mandatos Solo Funciones' })
    tutor = await createTestUser({ nombre: 'Tutor Mandatos Solo Funciones' })
    await asignarRol(admin.id, centro.id, 'admin')
    await crearFamiliaTutor(familia, tutor.id, 'titular')
    cAdmin = await clientFor(admin)
    cTutor = await clientFor(tutor)
  }, 60_000)

  afterAll(async () => {
    borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, tutor, ...usuariosExtra]) await deleteTestUser(u.id)
  })

  it('lo legítimo pasa: el tutor registra y la admin registra presencial', async () => {
    const r = await cTutor.rpc(
      'registrar_mandato_sepa',
      argsMandato(familia, IBAN_1, 'SOLO-FUNC-1')
    )
    expect(r.error).toBeNull()
    mandatoId = r.data as unknown as string
    expect((await leer(mandatoId)).estado).toBe('activo')

    const p = await cAdmin.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaB, IBAN_2, 'SOLO-FUNC-2', 'presencial')
    )
    expect(p.error).toBeNull()
    expect((await leer(p.data as unknown as string)).estado).toBe('activo')
  })

  it('nadie lo crea directamente: tutor, admin y service_role reciben 42501', async () => {
    expect(mandatoId).toBeDefined()
    // Cada intento va a una familia SIN mandato y que quien lo intenta puede tocar (el tutor, la
    // suya): así no lo para ni el índice de un activo por familia (23505) ni la RLS de la familia.
    const tutorC = await createTestUser({ nombre: 'Tutor C Mandatos Solo Funciones' })
    usuariosExtra.push(tutorC)
    const familiaC = await createTestFamilia(centro.id)
    await crearFamiliaTutor(familiaC, tutorC.id, 'titular')
    const cTutorC = await clientFor(tutorC)
    const intentos: Array<[string, SupabaseClient<Database>, string, string]> = [
      ['tutor', cTutorC, tutorC.id, familiaC],
      ['admin', cAdmin, admin.id, await createTestFamilia(centro.id)],
      ['service_role', serviceClient, admin.id, await createTestFamilia(centro.id)],
    ]
    for (const [quien, c, usuario, fam] of intentos) {
      const { count: previos } = await serviceClient
        .from('mandatos_sepa')
        .select('id', { count: 'exact', head: true })
        .eq('familia_id', fam)
      expect(previos, `${quien}: la familia empieza sin mandato`).toBe(0)
      const { error } = await c.from('mandatos_sepa').insert({
        centro_id: centro.id,
        familia_id: fam,
        usuario_id: usuario,
        identificador_mandato: `SOLO-FUNC-INS-${quien}`,
        titular: 'Titular Pruebas',
        iban_cifrado: '\\x00',
      } as never)
      expect.soft(error?.code, `${quien} INSERT`).toBe('42501')
    }
    const { count } = await serviceClient
      .from('mandatos_sepa')
      .select('id', { count: 'exact', head: true })
      .like('identificador_mandato', 'SOLO-FUNC-INS-%')
    expect(count).toBe(0)
  })

  it('nadie lo cambia directamente: ni una columna, ni el tutor ni la admin ni service_role', async () => {
    expect(mandatoId).toBeDefined()
    const antes = await leer(mandatoId)
    const clientes: Array<[string, SupabaseClient<Database>]> = [
      ['tutor', cTutor],
      ['admin', cAdmin],
      ['service_role', serviceClient],
    ]
    for (const [quien, c] of clientes) {
      for (const [col, valor] of Object.entries(cambios(familiaB, admin.id))) {
        const { error } = await c
          .from('mandatos_sepa')
          .update({ [col]: valor } as never)
          .eq('id', mandatoId)
        expect.soft(error?.code, `${quien} UPDATE ${col}`).toBe('42501')
      }
    }
    expect(await leer(mandatoId)).toEqual(antes)
  })

  it('nadie lo borra directamente: tutor, admin y service_role reciben 42501', async () => {
    expect(mandatoId).toBeDefined()
    const clientes: Array<[string, SupabaseClient<Database>]> = [
      ['tutor', cTutor],
      ['admin', cAdmin],
      ['service_role', serviceClient],
    ]
    for (const [quien, c] of clientes) {
      const { error } = await c.from('mandatos_sepa').delete().eq('id', mandatoId)
      expect.soft(error?.code, `${quien} DELETE`).toBe('42501')
    }
    expect((await leer(mandatoId)).estado).toBe('activo')
  })

  it('lo legítimo pasa: sustituir deja el anterior revocado y uno nuevo activo', async () => {
    expect(mandatoId).toBeDefined()
    const s = await cTutor.rpc(
      'sustituir_mandato_sepa',
      argsMandato(familia, IBAN_2, 'SOLO-FUNC-3')
    )
    expect(s.error).toBeNull()
    expect((await leer(mandatoId)).estado).toBe('revocado')
    expect((await leer(s.data as unknown as string)).estado).toBe('activo')
  })
})
