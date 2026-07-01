import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
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
 * F12-B-6 — Devoluciones. Verifica:
 *  1) CHECK reescrito recibos_envio_banco_fecha: 'devuelto' EXIGE fecha_devolucion
 *     (sin ella → 23514) y CONSERVA fecha_envio_banco.
 *  2) El congelado afinado (B-5) encaja: en mes CERRADO, marcar enviado_banco →
 *     devuelto (solo estado + fecha_devolucion) PASA.
 *  3) cobrado_manual anula ambas fechas y cumple el CHECK.
 *
 * Gateado: F12B_6_RLS_APPLIED=1 (migración phase12b_6 aplicada). No en CI hasta aplicar.
 */

const APPLIED = process.env.F12B_6_RLS_APPLIED === '1'

describe.skipIf(!APPLIED)('F12-B-6 — devoluciones (CHECK + congelado)', () => {
  let centroA: { id: string }
  let ninoA: { id: string }
  let adminA: TestUser
  let cAdminA: SupabaseClient<Database>
  let reciboAbierto: string // mes abierto, para el CHECK
  let reciboCerrado: string // mes cerrado, para el congelado

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A F12B6')
    const cursoA = await createTestCurso(centroA.id)
    const aulaA = await createTestAula(centroA.id, cursoA.id)
    ninoA = await createTestNino(centroA.id, 'Nino A F12B6')
    await matricular(ninoA.id, aulaA.id, cursoA.id)

    adminA = await createTestUser({ nombre: 'Admin A F12B6' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    cAdminA = await clientFor(adminA)

    // Recibo enviado_banco en mes ABIERTO (2025-04) — para probar el CHECK sin freeze.
    const { data: rAbierto } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        nino_id: ninoA.id,
        anio: 2025,
        mes: 4,
        metodo: 'sepa',
        estado: 'enviado_banco',
        fecha_envio_banco: '2025-04-05',
        total_centimos: 10000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    reciboAbierto = rAbierto!.id

    // Recibo enviado_banco en mes CERRADO (2025-03) — para el congelado afinado.
    const { data: rCerrado } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        nino_id: ninoA.id,
        anio: 2025,
        mes: 3,
        metodo: 'sepa',
        estado: 'enviado_banco',
        fecha_envio_banco: '2025-03-05',
        total_centimos: 12000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    reciboCerrado = rCerrado!.id

    await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centroA.id, anio: 2025, mes: 3, cerrado_por: adminA.id })
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centroA.id)
    await deleteTestUser(adminA.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  it('CHECK: marcar devuelto SIN fecha_devolucion falla (23514)', async () => {
    const { error } = await cAdminA
      .from('recibos')
      .update({ estado: 'devuelto' })
      .eq('id', reciboAbierto)
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })

  it('devuelto conserva fecha_envio_banco + exige fecha_devolucion', async () => {
    const { data, error } = await cAdminA
      .from('recibos')
      .update({ estado: 'devuelto', fecha_devolucion: '2025-04-20' })
      .eq('id', reciboAbierto)
      .select('estado, fecha_envio_banco, fecha_devolucion')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.estado).toBe('devuelto')
    expect(data?.fecha_envio_banco).toBe('2025-04-05') // conservada
    expect(data?.fecha_devolucion).toBe('2025-04-20')
  })

  it('congelado afinado: en mes cerrado, enviado_banco → devuelto PASA', async () => {
    const { data, error } = await cAdminA
      .from('recibos')
      .update({ estado: 'devuelto', fecha_devolucion: '2025-03-20' })
      .eq('id', reciboCerrado)
      .select('estado, fecha_envio_banco')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.estado).toBe('devuelto')
    expect(data?.fecha_envio_banco).toBe('2025-03-05') // conservada pese al cierre
  })

  it('cobrado_manual anula ambas fechas y cumple el CHECK', async () => {
    const { data, error } = await cAdminA
      .from('recibos')
      .update({ estado: 'cobrado_manual', fecha_envio_banco: null, fecha_devolucion: null })
      .eq('id', reciboCerrado)
      .select('estado, fecha_envio_banco, fecha_devolucion')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.estado).toBe('cobrado_manual')
    expect(data?.fecha_envio_banco).toBeNull()
    expect(data?.fecha_devolucion).toBeNull()
  })
})
