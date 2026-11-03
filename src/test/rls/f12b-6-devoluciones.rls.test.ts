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
import { intentarConMarcador, pasarAEnviadoComoMarcar } from './remesa-como-sus-funciones'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F12-B-6 — Devoluciones. Verifica:
 *  1) CHECK reescrito recibos_envio_banco_fecha: 'devuelto' EXIGE fecha_devolucion
 *     (sin ella → 23514) y CONSERVA fecha_envio_banco.
 *  2) El congelado afinado (B-5) encaja: en mes CERRADO, marcar enviado_banco →
 *     devuelto (solo estado + fecha_devolucion) PASA.
 *  3) cobrado_manual de un devuelto CONSERVA las dos fechas de banco (PR-1a; hasta entonces el
 *     CHECK obligaba a anularlas) y lleva su forma y su fecha de cobro. Desde el PR-2 se cobra por
 *     `resolver_devolucion` (una sola salida) y la devolución lleva sus gastos; el re-giro y el resto
 *     de la salida única están en `recibos-devolucion-una-salida.rls.test.ts`.
 *  Desde `20261223120000` la devolución se registra con `marcar_recibo_devuelto` (invoker: con la
 *  sesión de la directora, el congelado actúa igual que con el UPDATE de antes), y por fuera la para
 *  `recibos_dinero_solo_por_funcion`. Al CHECK solo se llega con el marcador de la función puesto.
 */

describe('F12-B-6 — devoluciones (CHECK + congelado)', () => {
  let centroA: { id: string }
  let ninoA: { id: string; familia_id: string }
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
        familia_id: ninoA.familia_id, // F-4-1: recibos a grano familia
        nino_id: ninoA.id,
        anio: 2025,
        mes: 4,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 10000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    reciboAbierto = rAbierto!.id
    // Enviado: solo como lo pasa marcar_remesa_enviada (20261222120000).
    pasarAEnviadoComoMarcar([reciboAbierto], '2025-04-05')

    // Recibo enviado_banco en mes CERRADO (2025-03) — para el congelado afinado.
    const { data: rCerrado } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centroA.id,
        familia_id: ninoA.familia_id, // F-4-1: recibos a grano familia
        nino_id: ninoA.id,
        anio: 2025,
        mes: 3,
        metodo: 'sepa',
        estado: 'pendiente_procesar',
        total_centimos: 12000,
        es_esporadico: false,
      })
      .select('id')
      .single()
    reciboCerrado = rCerrado!.id
    pasarAEnviadoComoMarcar([reciboCerrado], '2025-03-05')

    await serviceClient
      .from('cierre_mensual')
      .insert({ centro_id: centroA.id, anio: 2025, mes: 3, cerrado_por: adminA.id })
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
    // Los re-giros referencian al recibo original con ON DELETE RESTRICT: borrarlos
    // primero (los linked) para que el DELETE masivo de recibos no viole la FK.
    await serviceClient
      .from('recibos')
      .delete()
      .eq('centro_id', centroA.id)
      .not('devuelto_de_recibo_id', 'is', null)
    await serviceClient.from('recibos').delete().eq('centro_id', centroA.id)
    await deleteTestUser(adminA.id)
    await deleteTestCentro(centroA.id)
  }, 60_000)

  function devolver(id: string, fecha: string | null) {
    return cAdminA.rpc('marcar_recibo_devuelto', {
      p_recibo_id: id,
      p_fecha: fecha as string,
      p_gastos_centimos: 0,
    })
  }

  it('CHECK: marcar devuelto SIN fecha_devolucion falla (23514)', async () => {
    // Por fuera, el trigger nuevo; por la función, su rechazo; y con el marcador puesto, el CHECK.
    const directo = await cAdminA
      .from('recibos')
      .update({ estado: 'devuelto' })
      .eq('id', reciboAbierto)
      .select('id')
      .maybeSingle()
    expect(directo.error?.code).toBe('P0001')
    expect(directo.error?.hint).toBe('devuelto_por_funcion')
    expect((await devolver(reciboAbierto, null)).error?.hint).toBe('datos_no_validos')
    const sinFecha = intentarConMarcador(
      reciboAbierto,
      'app.marcar_recibo_devuelto',
      "estado = 'devuelto'"
    )
    expect(sinFecha).toMatchObject({ pasa: false, code: '23514' })
    expect(sinFecha.pasa === false && sinFecha.message).toContain('recibos_envio_banco_fecha')
    // Control: el mismo intento con su fecha pasa (y se deshace).
    expect(
      intentarConMarcador(
        reciboAbierto,
        'app.marcar_recibo_devuelto',
        "estado = 'devuelto', fecha_devolucion = '2025-04-20', devolucion_gastos_centimos = 0"
      )
    ).toEqual({ pasa: true, filas: 1 })
  })

  it('devuelto conserva fecha_envio_banco + exige fecha_devolucion', async () => {
    expect((await devolver(reciboAbierto, '2025-04-20')).error).toBeNull()
    const { data } = await cAdminA
      .from('recibos')
      .select('estado, fecha_envio_banco, fecha_devolucion')
      .eq('id', reciboAbierto)
      .maybeSingle()
    expect(data?.estado).toBe('devuelto')
    expect(data?.fecha_envio_banco).toBe('2025-04-05') // conservada
    expect(data?.fecha_devolucion).toBe('2025-04-20')
  })

  it('congelado afinado: en mes cerrado, enviado_banco → devuelto PASA', async () => {
    // Premisa: el mes del recibo está cerrado (si no, el congelado no estaría en juego).
    const { data: cerrado } = await cAdminA.rpc('mes_cerrado', {
      p_centro_id: centroA.id,
      p_anio: 2025,
      p_mes: 3,
    })
    expect(cerrado).toBe(true)
    expect((await devolver(reciboCerrado, '2025-03-20')).error).toBeNull()
    const { data } = await cAdminA
      .from('recibos')
      .select('estado, fecha_envio_banco')
      .eq('id', reciboCerrado)
      .maybeSingle()
    expect(data?.estado).toBe('devuelto')
    expect(data?.fecha_envio_banco).toBe('2025-03-05') // conservada pese al cierre
  })

  it('cobrado_manual de un devuelto conserva las dos fechas de banco (PR-1a; por su función desde el PR-2)', async () => {
    const { error } = await cAdminA.rpc('resolver_devolucion', {
      p_recibo_id: reciboCerrado,
      p_salida: 'efectivo',
      p_fecha: '2025-03-25',
      p_nota: null as unknown as string,
    })
    expect(error).toBeNull()
    const { data } = await cAdminA
      .from('recibos')
      .select('estado, fecha_envio_banco, fecha_devolucion, cobro_forma, cobro_fecha')
      .eq('id', reciboCerrado)
      .maybeSingle()
    expect(data?.estado).toBe('cobrado_manual')
    expect(data?.fecha_envio_banco).toBe('2025-03-05')
    expect(data?.fecha_devolucion).toBe('2025-03-20')
    expect(data?.cobro_forma).toBe('efectivo')
    expect(data?.cobro_fecha).toBe('2025-03-25')
  })
})
