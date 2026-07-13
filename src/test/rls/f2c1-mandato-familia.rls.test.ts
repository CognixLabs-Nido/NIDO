import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-2c-1 — el mandato SEPA es de la FAMILIA (nino_id relajado a nullable; cuelga de
 * familia_id). Verifica:
 *  1) `registrar_mandato_sepa(p_familia_id, …)` crea 1 fila activa con familia_id set;
 *     el centro_id se DERIVA de familia_id (no de nino_id, que es informativo/opcional).
 *  2) Un 2º `registrar` en la misma familia es UPSERT-in-place (idempotente): sigue
 *     habiendo 1 solo activo; un INSERT crudo de un 2º activo viola el índice único.
 *  3) `sustituir_mandato_sepa`: el activo pasa a 'revocado' (conservado, deleted_at NULL)
 *     y el nuevo queda 'activo'; solo 1 activo tras sustituir.
 *  4) `get_mandatos_remesa` resuelve el IBAN del deudor por la FAMILIA del niño del recibo.
 *  5) Gate del alta (2º hijo): la familia con mandato lo tiene visible al consultar por la
 *     familia del 2º hijo, sin volver a firmar.
 *  6) authz: admin y tutor de la familia OK; tutor de otra familia y profe → denegados.
 *
 * Gateado: F2C1_MIGRATION_APPLIED=1 (requiere la migración phase_f2c1 aplicada + el
 * secreto sepa_encryption_key en Vault). No corre en CI hasta que el operador la aplica.
 */

const APPLIED = process.env.F2C1_MIGRATION_APPLIED === '1'

const IBAN_1 = 'ES7620770024003102575766'
const IBAN_2 = 'ES9121000418450200051332'

function argsMandato(familiaId: string, ninoId: string | null, iban: string, id: string) {
  return {
    p_familia_id: familiaId,
    p_nino_id: ninoId,
    p_iban: iban,
    p_titular: 'Ana Pérez',
    p_identificador_mandato: id,
    p_documento_path: '',
    p_firma_imagen: '',
    p_nombre_tecleado: 'Ana Pérez',
    p_texto_hash: 'a'.repeat(64),
    p_ip_address: null,
    p_user_agent: 'test',
    p_fecha_firma: '2026-02-01T10:00:00Z',
  } as never
}

describe.skipIf(!APPLIED)('F-2c-1 — mandato SEPA de FAMILIA', () => {
  let centroA: { id: string }
  let familiaA: string
  let ninoA1: { id: string }
  let ninoA2: { id: string }
  let adminA: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  let ninoOtro: TestNino
  let tutorOtro: TestUser
  let cAdminA: SupabaseClient<Database>
  let cProfeA: SupabaseClient<Database>
  let cTutorA: SupabaseClient<Database>
  let cTutorOtro: SupabaseClient<Database>

  async function insertarNino(familiaId: string, nombre: string): Promise<{ id: string }> {
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroA.id,
        familia_id: familiaId,
        nombre,
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`insertarNino falló: ${error?.message}`)
    return { id: data.id }
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A F2C1')
    const cursoA = await createTestCurso(centroA.id)
    const aulaA = await createTestAula(centroA.id, cursoA.id)

    // Una familia con DOS hijos (para el caso "2º hijo": mandato de familia, no de niño).
    familiaA = await createTestFamilia(centroA.id)
    ninoA1 = await insertarNino(familiaA, 'Nino A1 F2C1')
    ninoA2 = await insertarNino(familiaA, 'Nino A2 F2C1')
    await matricular(ninoA1.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin A F2C1' })
    profeA = await createTestUser({ nombre: 'Profe A F2C1' })
    tutorA = await createTestUser({ nombre: 'Tutor A F2C1' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarProfeAula(profeA.id, aulaA.id, cursoA.id)
    await crearVinculo(ninoA1.id, tutorA.id, 'tutor_legal_principal', {})
    await crearFamiliaTutor(familiaA, tutorA.id, 'titular')

    // Otra familia + su tutor (aislamiento entre familias).
    ninoOtro = await createTestNino(centroA.id, 'Nino Otro F2C1')
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro F2C1' })
    await crearFamiliaTutor(ninoOtro.familia_id, tutorOtro.id, 'titular')

    cAdminA = await clientFor(adminA)
    cProfeA = await clientFor(profeA)
    cTutorA = await clientFor(tutorA)
    cTutorOtro = await clientFor(tutorOtro)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centroA.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(profeA.id)
    await deleteTestUser(tutorA.id)
    await deleteTestUser(tutorOtro.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  it('registra el mandato de la familia: 1 activo, familia_id set, centro_id derivado de familia', async () => {
    const { error } = await cTutorA.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaA, ninoA1.id, IBAN_1, 'NIDO-F2C1-1')
    )
    expect(error).toBeNull()

    const { data } = await serviceClient
      .from('mandatos_sepa')
      .select('id, familia_id, centro_id, estado')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(data).toHaveLength(1)
    expect(data![0].familia_id).toBe(familiaA)
    // centro_id derivado de familia_id por el trigger (no de nino_id).
    expect(data![0].centro_id).toBe(centroA.id)
  })

  it('registrar con el MISMO IBAN (reintento del alta) es UPDATE in-place: 1 activo, sin fila revocada', async () => {
    // Mismo IBAN_1 pero con espacios y otro identificador → normaliza y ACTUALIZA en su sitio
    // (no ensucia histórico). Prueba también la normalización (quita espacios, upper).
    const { error } = await cTutorA.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaA, ninoA1.id, 'ES76 2077 0024 0031 0257 5766', 'NIDO-F2C1-1B')
    )
    expect(error).toBeNull()

    const { data: activos } = await serviceClient
      .from('mandatos_sepa')
      .select('id, identificador_mandato')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(activos).toHaveLength(1)
    expect(activos![0].identificador_mandato).toBe('NIDO-F2C1-1B') // actualizado en su sitio

    // No se generó histórico (ninguna fila 'revocado') por un reintento con el mismo IBAN.
    const { data: revocados } = await serviceClient
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', familiaA)
      .eq('estado', 'revocado')
    expect(revocados ?? []).toHaveLength(0)
  })

  it('registrar con un IBAN DISTINTO estando la familia con mandato activo → RAISE, no pisa', async () => {
    const { error } = await cTutorA.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaA, ninoA1.id, IBAN_2, 'NIDO-F2C1-OTRO')
    )
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/mandato_activo_otro_iban/)

    // El mandato activo NO cambió (sigue el reintento in-place NIDO-F2C1-1B) y no hay filas nuevas.
    const { data: activos } = await serviceClient
      .from('mandatos_sepa')
      .select('id, identificador_mandato')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(activos).toHaveLength(1)
    expect(activos![0].identificador_mandato).toBe('NIDO-F2C1-1B')
    const { data: revocados } = await serviceClient
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', familiaA)
      .eq('estado', 'revocado')
    expect(revocados ?? []).toHaveLength(0)
  })

  it('el índice único rechaza un 2º mandato ACTIVO insertado a mano en la familia', async () => {
    const { error } = await serviceClient.from('mandatos_sepa').insert({
      centro_id: centroA.id,
      familia_id: familiaA,
      nino_id: ninoA1.id,
      usuario_id: tutorA.id,
      iban_cifrado: '\\x00', // bytea dummy; el índice salta antes de importar el valor
      titular: 'Duplicado',
      identificador_mandato: 'NIDO-F2C1-DUP',
      estado: 'activo',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505') // unique_violation
  })

  it('el índice único rechaza un 2º mandato ACTIVO insertado a mano en la familia', async () => {
    const { error } = await serviceClient.from('mandatos_sepa').insert({
      centro_id: centroA.id,
      familia_id: familiaA,
      nino_id: ninoA1.id,
      usuario_id: tutorA.id,
      iban_cifrado: '\\x00', // bytea dummy; el índice salta antes de importar el valor
      titular: 'Duplicado',
      identificador_mandato: 'NIDO-F2C1-DUP',
      estado: 'activo',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505') // unique_violation
  })

  it('centro_id se deriva de familia_id aunque nino_id sea NULL (informativo)', async () => {
    const familiaSolo = await createTestFamilia(centroA.id)
    await crearFamiliaTutor(familiaSolo, tutorA.id, 'segundo_tutor')
    const { error } = await cTutorA.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaSolo, null, IBAN_1, 'NIDO-F2C1-SOLO')
    )
    expect(error).toBeNull()

    const { data } = await serviceClient
      .from('mandatos_sepa')
      .select('centro_id, nino_id')
      .eq('familia_id', familiaSolo)
      .maybeSingle()
    expect(data?.nino_id).toBeNull()
    expect(data?.centro_id).toBe(centroA.id)
  })

  it('sustituir: el activo pasa a revocado (conservado) y el nuevo queda activo; 1 solo activo', async () => {
    const { error } = await cTutorA.rpc(
      'sustituir_mandato_sepa',
      argsMandato(familiaA, ninoA1.id, IBAN_1, 'NIDO-F2C1-SUST')
    )
    expect(error).toBeNull()

    const { data: activos } = await serviceClient
      .from('mandatos_sepa')
      .select('id, identificador_mandato')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(activos).toHaveLength(1)
    expect(activos![0].identificador_mandato).toBe('NIDO-F2C1-SUST')

    // El anterior se conserva como 'revocado' (deleted_at NULL).
    const { data: revocados } = await serviceClient
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', familiaA)
      .eq('estado', 'revocado')
      .is('deleted_at', null)
    expect((revocados ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('gate del alta (2º hijo): la familia con mandato lo tiene al consultar por la familia del 2º hijo', async () => {
    // El 2º hijo comparte familia_id → la consulta del gate (por familia) encuentra el mandato
    // sin registrar uno nuevo.
    const { data: ninoRow } = await cAdminA
      .from('ninos')
      .select('familia_id')
      .eq('id', ninoA2.id)
      .maybeSingle()
    const { data: mandato } = await cAdminA
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', ninoRow!.familia_id!)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .maybeSingle()
    expect(mandato).not.toBeNull()
  })

  it('get_mandatos_remesa resuelve el IBAN del deudor por la FAMILIA del niño del recibo', async () => {
    // Recibo SEPA de ninoA2 (cuyo mandato es el de la familia, registrado por ninoA1/sustituir).
    const { data: recibo } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        nino_id: ninoA2.id,
        anio: 2026,
        mes: 2,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 12000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    const { data: remesa } = await serviceClient
      .from('remesas')
      .insert({ centro_id: centroA.id, anio: 2026, mes: 2, estado: 'borrador' })
      .select('id')
      .single()
    await serviceClient
      .from('recibos_remesa')
      .insert({ centro_id: centroA.id, remesa_id: remesa!.id, recibo_id: recibo!.id })

    const { data, error } = await cAdminA.rpc('get_mandatos_remesa', { p_remesa_id: remesa!.id })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    // El mandato vigente de la familia tras sustituir usa IBAN_1.
    expect(data![0].iban).toBe(IBAN_1)
    expect(data![0].identificador_mandato).toBe('NIDO-F2C1-SUST')
    expect(data![0].nino_id).toBe(ninoA2.id)

    await serviceClient.from('recibos_remesa').delete().eq('remesa_id', remesa!.id)
    await serviceClient.from('remesas').delete().eq('id', remesa!.id)
    await serviceClient.from('recibos').delete().eq('id', recibo!.id)
  })

  it('authz: el admin ve el mandato de la familia', async () => {
    const { data } = await cAdminA
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('authz: un tutor de OTRA familia y un profe NO ven el mandato; no pueden registrar', async () => {
    const otro = await cTutorOtro.from('mandatos_sepa').select('id').eq('familia_id', familiaA)
    expect(otro.data ?? []).toHaveLength(0)
    const profe = await cProfeA.from('mandatos_sepa').select('id').eq('familia_id', familiaA)
    expect(profe.data ?? []).toHaveLength(0)

    // El tutor de otra familia no puede registrar en familiaA (gate es_tutor_de_familia).
    const { error } = await cTutorOtro.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaA, ninoA1.id, IBAN_1, 'NIDO-F2C1-HACK')
    )
    expect(error).not.toBeNull()
  })
})
