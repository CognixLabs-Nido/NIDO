import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  expectLecturaAnonDenegada,
  clientFor,
  createTestUser,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Limpieza de seguridad PR-1 — las 10 RPCs críticas cerradas a anon.
 *
 * Migración: 20261002140000_fix_rpc_criticas_anon
 *   - anon NO tiene EXECUTE en ninguna de las 10 (PostgREST → 42501 antes de entrar al cuerpo).
 *   - _get_medical_key / _get_sepa_key: solo el dueño (ni authenticated ni service_role).
 *
 * Guarda de regresión: los default privileges de Postgres re-conceden EXECUTE a PUBLIC/anon a
 * cada función que se (re)crea, y así llegaron estos agujeros. Si alguien reabre el permiso, este
 * test se pone rojo. Ancla positiva: el mismo cliente anon lee una tabla (0 filas, sin
 * error), así que el 42501 es del permiso y no de un cliente roto.
 *
 * La rama «uid NULL sin ser servicio» del cuerpo y la sesión directa no se pueden provocar desde
 * PostgREST; quedaron cubiertas por el ensayo con rollback contra el remoto (body del PR #293).
 *
 * Gateado (la migración la aplica Jose a mano): RPC_CRITICAS_ANON_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.RPC_CRITICAS_ANON_APPLIED === '1'

type Client = SupabaseClient<Database>

/** Las 10 llamadas, con argumentos de relleno (la ACL se comprueba antes que el cuerpo). */
const CRITICAS: Array<[string, (c: Client) => PromiseLike<{ error: { code?: string } | null }>]> = [
  ['_get_medical_key', (c) => c.rpc('_get_medical_key')],
  ['_get_sepa_key', (c) => c.rpc('_get_sepa_key')],
  [
    'registrar_consentimiento',
    (c) =>
      c.rpc('registrar_consentimiento', {
        p_usuario_id: randomUUID(),
        p_tipo: 'terminos',
        p_version: 'v-test',
      }),
  ],
  [
    'solicitar_olvido_usuario',
    (c) => c.rpc('solicitar_olvido_usuario', { p_usuario_id: randomUUID(), p_inmediato: false }),
  ],
  [
    'solicitar_olvido_nino',
    (c) => c.rpc('solicitar_olvido_nino', { p_nino_id: randomUUID(), p_inmediato: false }),
  ],
  ['purgar_sujeto_db', (c) => c.rpc('purgar_sujeto_db', { p_solicitud_id: randomUUID() })],
  ['olvido_pendientes', (c) => c.rpc('olvido_pendientes')],
  [
    'listar_esqueletos_huerfanos_stub',
    (c) => c.rpc('listar_esqueletos_huerfanos_stub', { p_cutoff: new Date().toISOString() }),
  ],
  [
    'es_esqueleto_stub_purgable',
    (c) =>
      c.rpc('es_esqueleto_stub_purgable', {
        p_usuario_id: randomUUID(),
        p_cutoff: new Date().toISOString(),
      }),
  ],
  [
    'purgar_esqueleto_huerfano_nino',
    (c) =>
      c.rpc('purgar_esqueleto_huerfano_nino', {
        p_nino_id: randomUUID(),
        p_cutoff: new Date().toISOString(),
      }),
  ],
]

const CLAVES = CRITICAS.filter(([nombre]) => nombre.startsWith('_get_'))

describe.skipIf(!MIGRATION_APPLIED)('RPCs críticas — cerradas a anon', () => {
  let usuario: TestUser
  let autenticado: Client

  beforeAll(async () => {
    usuario = await createTestUser({ nombre: 'Usuario RPC Criticas' })
    autenticado = await clientFor(usuario)
  }, 60_000)

  afterAll(async () => {
    await deleteTestUser(usuario.id)
  }, 60_000)

  // Ancla: anon no puede ejecutar ninguna función de public (20261010130000) ni, desde
  // 20261010140000, tocar ninguna tabla. El 42501 «permission denied for table» solo lo devuelve
  // Postgres a través de PostgREST: prueba que el cliente llega a la BD y que el rechazo es del
  // permiso. Antes de esa migración (flag apagado) anon leía 0 filas sin error.
  it('ancla: el cliente anon llega a la BD (lectura de tabla denegada por permiso)', async () => {
    expectLecturaAnonDenegada(await anonClient().from('centros').select('id').limit(1), 'centros')
  })

  it.each(CRITICAS)('anon NO ejecuta %s (sin EXECUTE → 42501)', async (_nombre, llamar) => {
    const { error } = await llamar(anonClient())
    expect(error?.code).toBe('42501')
  })

  it.each(CLAVES)('authenticated NO ejecuta %s (solo el dueño)', async (_nombre, llamar) => {
    const { error } = await llamar(autenticado)
    expect(error?.code).toBe('42501')
  })

  it.each(CLAVES)('service_role tampoco ejecuta %s (solo el dueño)', async (_nombre, llamar) => {
    const { error } = await llamar(serviceClient)
    expect(error?.code).toBe('42501')
  })
})
