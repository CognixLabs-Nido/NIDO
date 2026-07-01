import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  crearVinculo,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F12-B-5 — RLS/reglas de la remesa SEPA. Verifica:
 *  1) CONGELADO AFINADO: en un recibo REGULAR de un mes CERRADO, un UPDATE que solo
 *     cambia estado/fecha_envio_banco PASA (ciclo de cobro); un UPDATE de
 *     total_centimos FALLA con P0001 (contenido económico inmutable, decisión F/J).
 *  2) get_mandatos_remesa: admin descifra el IBAN de los recibos de la remesa; un
 *     tutor (no admin) es rechazado.
 *  3) set/get_datos_acreedor: round-trip del IBAN cifrado del acreedor; tutor rechazado.
 *
 * Gateado: F12B_5_RLS_APPLIED=1 (requiere la migración phase12b_5 aplicada). No se
 * activa en CI hasta que el operador la aplica (patrón H-0).
 */

const APPLIED = process.env.F12B_5_RLS_APPLIED === '1'

const IBAN_DEUDOR = 'ES7620770024003102575766'
const IBAN_ACREEDOR = 'ES9121000418450200051332'
const CID = 'ES00ZZZ00000000000'
const BIC = 'CAIXESBBXXX'

describe.skipIf(!APPLIED)('F12-B-5 — remesa SEPA (congelado afinado · RPCs)', () => {
  let centroA: { id: string }
  let ninoA: { id: string }
  let adminA: TestUser
  let tutorA: TestUser
  let cAdminA: SupabaseClient<Database>
  let cTutorA: SupabaseClient<Database>
  let reciboId: string
  let remesaId: string
  const anio = 2025
  const mes = 3

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A F12B5')
    const cursoA = await createTestCurso(centroA.id)
    const aulaA = await createTestAula(centroA.id, cursoA.id)
    ninoA = await createTestNino(centroA.id, 'Nino A F12B5')
    await matricular(ninoA.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin A F12B5' })
    tutorA = await createTestUser({ nombre: 'Tutor A F12B5' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {})
    cAdminA = await clientFor(adminA)
    cTutorA = await clientFor(tutorA)

    // Recibo regular SEPA (mes AÚN abierto: pasa el trigger en INSERT).
    const { data: recibo } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        nino_id: ninoA.id,
        anio,
        mes,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 10000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    reciboId = recibo!.id

    // Mandato SEPA activo del niño (vía RPC del tutor: cifra el IBAN).
    await cTutorA.rpc('registrar_mandato_sepa', {
      p_nino_id: ninoA.id,
      p_iban: IBAN_DEUDOR,
      p_titular: 'Ana Pérez',
      p_identificador_mandato: 'NIDO-F12B5-TUT-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Ana Pérez',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2025-02-01T10:00:00Z',
    })

    // Remesa borrador + enlace del recibo.
    const { data: remesa } = await serviceClient
      .from('remesas')
      .insert({ centro_id: centroA.id, anio, mes, estado: 'borrador' })
      .select('id')
      .single()
    remesaId = remesa!.id
    await serviceClient
      .from('recibos_remesa')
      .insert({ centro_id: centroA.id, remesa_id: remesaId, recibo_id: reciboId })

    // Cerrar el mes (inserta cierre_mensual → el trigger de congelado ya aplica).
    await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centroA.id, anio, mes, cerrado_por: adminA.id })
  }, 60_000)

  afterAll(async () => {
    // Orden: quitar el cierre ANTES de borrar recibos (el trigger bloquea DELETE de
    // recibo regular de mes cerrado). serviceClient bypassa RLS.
    await serviceClient.from('recibos_remesa').delete().eq('centro_id', centroA.id)
    await serviceClient.from('remesas').delete().eq('centro_id', centroA.id)
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centroA.id)
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centroA.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(tutorA.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  it('congelado afinado: UPDATE de solo estado/fecha en recibo de mes cerrado PASA', async () => {
    const { data, error } = await cAdminA
      .from('recibos')
      .update({ estado: 'enviado_banco', fecha_envio_banco: '2025-03-05' })
      .eq('id', reciboId)
      .select('id, estado')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.estado).toBe('enviado_banco')
  })

  it('congelado: UPDATE de total_centimos en recibo de mes cerrado FALLA con P0001', async () => {
    const { error } = await cAdminA
      .from('recibos')
      .update({ total_centimos: 99999 })
      .eq('id', reciboId)
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('P0001')
  })

  it('get_mandatos_remesa: el admin descifra el IBAN del deudor de la remesa', async () => {
    const { data, error } = await cAdminA.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    const fila = data![0]
    expect(fila.iban).toBe(IBAN_DEUDOR)
    expect(fila.identificador_mandato).toBe('NIDO-F12B5-TUT-1')
    expect(fila.titular).toBe('Ana Pérez')
    expect(fila.fecha_mandato).not.toBeNull()
  })

  it('get_mandatos_remesa: un tutor (no admin) es rechazado', async () => {
    const { error } = await cTutorA.rpc('get_mandatos_remesa', { p_remesa_id: remesaId })
    expect(error).not.toBeNull()
  })

  it('set/get_datos_acreedor: round-trip del IBAN cifrado del acreedor (admin)', async () => {
    const { error: errSet } = await cAdminA.rpc('set_datos_acreedor', {
      p_centro_id: centroA.id,
      p_identificador_acreedor: CID,
      p_bic_acreedor: BIC,
      p_iban: IBAN_ACREEDOR,
    })
    expect(errSet).toBeNull()

    const { data, error } = await cAdminA.rpc('get_datos_acreedor', { p_centro_id: centroA.id })
    expect(error).toBeNull()
    const fila = data![0]
    expect(fila.identificador_acreedor).toBe(CID)
    expect(fila.bic_acreedor).toBe(BIC)
    expect(fila.iban).toBe(IBAN_ACREEDOR)
  })

  it('datos_acreedor: un tutor (no admin) no puede escribir ni leer', async () => {
    const { error: errSet } = await cTutorA.rpc('set_datos_acreedor', {
      p_centro_id: centroA.id,
      p_identificador_acreedor: CID,
      p_bic_acreedor: BIC,
      p_iban: IBAN_ACREEDOR,
    })
    expect(errSet).not.toBeNull()

    const { error: errGet } = await cTutorA.rpc('get_datos_acreedor', { p_centro_id: centroA.id })
    expect(errGet).not.toBeNull()
  })
})
