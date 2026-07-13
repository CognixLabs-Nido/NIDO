import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  clientFor,
  createTestCentro,
  createTestFamilia,
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
 * F-2c-2 — `mandatos_sepa.iban_ultimos4` (enmascarado) rellenado por registrar/sustituir, y
 * lectura por la familia (base del INFORMATIVO del paso 8). Verifica:
 *  1) registrar rellena iban_ultimos4 = últimos 4 del IBAN normalizado (sin espacios).
 *  2) sustituir rellena iban_ultimos4 del NUEVO IBAN; el revocado CONSERVA el suyo.
 *  3) el tutor de la familia LEE iban_ultimos4/titular/identificador de su mandato activo
 *     (lo que consume `familiaTieneMandatoActivo`); un tutor de OTRA familia NO lo ve (RLS).
 *
 * Gateado: F2C2_MIGRATION_APPLIED=1 (requiere la migración phase_f2c2 aplicada + el secreto
 * sepa_encryption_key en Vault). No corre en CI hasta que el operador la aplica.
 */

const APPLIED = process.env.F2C2_MIGRATION_APPLIED === '1'

const IBAN_1_CON_ESPACIOS = 'ES76 2077 0024 0031 0257 5766' // últimos 4 = 5766
const IBAN_2 = 'ES9121000418450200051332' // últimos 4 = 1332

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

describe.skipIf(!APPLIED)('F-2c-2 — iban_ultimos4 (enmascarado del mandato de familia)', () => {
  let centroA: { id: string }
  let familiaA: string
  let tutorA: TestUser
  let familiaOtra: string
  let tutorOtro: TestUser
  let cTutorA: SupabaseClient<Database>
  let cTutorOtro: SupabaseClient<Database>

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A F2C2')

    familiaA = await createTestFamilia(centroA.id)
    tutorA = await createTestUser({ nombre: 'Tutor A F2C2' })
    await crearFamiliaTutor(familiaA, tutorA.id, 'titular')

    familiaOtra = await createTestFamilia(centroA.id)
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro F2C2' })
    await crearFamiliaTutor(familiaOtra, tutorOtro.id, 'titular')

    cTutorA = await clientFor(tutorA)
    cTutorOtro = await clientFor(tutorOtro)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centroA.id)
    await deleteTestUser(tutorA.id)
    await deleteTestUser(tutorOtro.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  it('registrar rellena iban_ultimos4 con los últimos 4 del IBAN normalizado (sin espacios)', async () => {
    const { error } = await cTutorA.rpc(
      'registrar_mandato_sepa',
      argsMandato(familiaA, null, IBAN_1_CON_ESPACIOS, 'NIDO-F2C2-1')
    )
    expect(error).toBeNull()

    const { data } = await serviceClient
      .from('mandatos_sepa')
      .select('iban_ultimos4, estado')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .maybeSingle()
    expect(data?.iban_ultimos4).toBe('5766')
  })

  it('el tutor de la familia lee iban_ultimos4/titular/identificador de su mandato activo', async () => {
    const { data, error } = await cTutorA
      .from('mandatos_sepa')
      .select('iban_ultimos4, titular, identificador_mandato')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.iban_ultimos4).toBe('5766')
    expect(data?.titular).toBe('Ana Pérez')
    expect(data?.identificador_mandato).toBe('NIDO-F2C2-1')
  })

  it('un tutor de OTRA familia NO ve el mandato de familiaA (RLS)', async () => {
    const { data } = await cTutorOtro
      .from('mandatos_sepa')
      .select('iban_ultimos4')
      .eq('familia_id', familiaA)
    expect(data ?? []).toHaveLength(0)
  })

  it('sustituir rellena iban_ultimos4 del NUEVO IBAN; el revocado conserva el suyo', async () => {
    const { error } = await cTutorA.rpc(
      'sustituir_mandato_sepa',
      argsMandato(familiaA, null, IBAN_2, 'NIDO-F2C2-SUST')
    )
    expect(error).toBeNull()

    // El activo nuevo lleva los últimos 4 del IBAN_2.
    const { data: activo } = await serviceClient
      .from('mandatos_sepa')
      .select('iban_ultimos4')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .maybeSingle()
    expect(activo?.iban_ultimos4).toBe('1332')

    // El revocado conserva los últimos 4 del IBAN_1 (no se recalcula al revocar).
    const { data: revocado } = await serviceClient
      .from('mandatos_sepa')
      .select('iban_ultimos4')
      .eq('familia_id', familiaA)
      .eq('estado', 'revocado')
      .is('deleted_at', null)
      .maybeSingle()
    expect(revocado?.iban_ultimos4).toBe('5766')
  })

  it('familia sin mandato → 0 filas activas (equivalente a informativo=null)', async () => {
    const { data } = await cTutorOtro
      .from('mandatos_sepa')
      .select('id')
      .eq('familia_id', familiaOtra)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(data ?? []).toHaveLength(0)
  })
})
