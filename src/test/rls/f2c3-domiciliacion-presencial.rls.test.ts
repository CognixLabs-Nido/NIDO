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
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-2c-3 — Dirección registra/sustituye la domiciliación de una familia en modo PRESENCIAL
 * (metodo_firma='presencial', sin PDF, sin trazo). Ejercita las RPCs por familia tal como las
 * llama la action `gestionarDomiciliacionFamilia`. Verifica:
 *  1) registrar (familia sin mandato) → 1 activo, metodo='presencial', documento_path NULL,
 *     firma_imagen '' (o NULL).
 *  2) sustituir → el viejo pasa a 'revocado' (conservado) y el nuevo queda 'activo' presencial.
 *  3) un no-admin (ni tutor de la familia) es rechazado por el gate de la RPC.
 *
 * Gateado: F2C2_MIGRATION_APPLIED=1 (las RPCs por familia + iban_ultimos4 ya existen; F-2c-3 no
 * añade migración). No corre en CI hasta que el operador aplica las migraciones SEPA.
 */

const APPLIED = process.env.F2C2_MIGRATION_APPLIED === '1'

const IBAN_1 = 'ES7620770024003102575766'
const IBAN_2 = 'ES9121000418450200051332'

function argsPresencial(familiaId: string, iban: string, id: string) {
  return {
    p_familia_id: familiaId,
    p_nino_id: null,
    p_iban: iban,
    p_titular: 'Ana Pérez',
    p_identificador_mandato: id,
    p_documento_path: null,
    p_firma_imagen: '',
    p_nombre_tecleado: 'Ana Pérez',
    p_texto_hash: null,
    p_ip_address: null,
    p_user_agent: null,
    p_fecha_firma: '2026-02-01T10:00:00Z',
    p_metodo: 'presencial',
  } as never
}

describe.skipIf(!APPLIED)('F-2c-3 — domiciliación presencial de Dirección', () => {
  let centroA: { id: string }
  let familiaA: string
  let adminA: TestUser
  let ajeno: TestUser
  let cAdminA: SupabaseClient<Database>
  let cAjeno: SupabaseClient<Database>

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A F2C3')
    familiaA = await createTestFamilia(centroA.id)
    adminA = await createTestUser({ nombre: 'Admin A F2C3' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    // Usuario sin relación con la familia ni rol admin del centro (ni tutor de la familia).
    ajeno = await createTestUser({ nombre: 'Ajeno F2C3' })
    const familiaAjena = await createTestFamilia(centroA.id)
    await crearFamiliaTutor(familiaAjena, ajeno.id, 'titular')

    cAdminA = await clientFor(adminA)
    cAjeno = await clientFor(ajeno)
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centroA.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(ajeno.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  it('el admin registra el 1er mandato PRESENCIAL: 1 activo, metodo=presencial, sin PDF', async () => {
    const { error } = await cAdminA.rpc(
      'registrar_mandato_sepa',
      argsPresencial(familiaA, IBAN_1, 'NIDO-F2C3-1')
    )
    expect(error).toBeNull()

    const { data } = await serviceClient
      .from('mandatos_sepa')
      .select('metodo_firma, documento_path, firma_imagen, iban_ultimos4, estado')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
      .maybeSingle()
    expect(data?.metodo_firma).toBe('presencial')
    expect(data?.documento_path).toBeNull()
    expect(data?.firma_imagen ?? '').toBe('')
    expect(data?.iban_ultimos4).toBe('5766')
  })

  it('el admin sustituye: viejo revocado (conservado), nuevo activo presencial', async () => {
    const { error } = await cAdminA.rpc(
      'sustituir_mandato_sepa',
      argsPresencial(familiaA, IBAN_2, 'NIDO-F2C3-SUST')
    )
    expect(error).toBeNull()

    const { data: activos } = await serviceClient
      .from('mandatos_sepa')
      .select('iban_ultimos4, metodo_firma')
      .eq('familia_id', familiaA)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    expect(activos).toHaveLength(1)
    expect(activos![0].iban_ultimos4).toBe('1332')
    expect(activos![0].metodo_firma).toBe('presencial')

    const { data: revocados } = await serviceClient
      .from('mandatos_sepa')
      .select('iban_ultimos4')
      .eq('familia_id', familiaA)
      .eq('estado', 'revocado')
      .is('deleted_at', null)
    expect((revocados ?? []).map((r) => r.iban_ultimos4)).toContain('5766')
  })

  it('un usuario sin relación con la familia NO puede registrar (gate de la RPC)', async () => {
    const { error } = await cAjeno.rpc(
      'registrar_mandato_sepa',
      argsPresencial(familiaA, IBAN_1, 'NIDO-F2C3-HACK')
    )
    expect(error).not.toBeNull()
  })
})
