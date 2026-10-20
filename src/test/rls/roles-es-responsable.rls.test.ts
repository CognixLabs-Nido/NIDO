import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PR 1 del modelo de roles — `privado.es_responsable`: lo que solo hace la admin del centro.
 *
 * Migración: 20261029120000_fix_roles_es_responsable
 *   - 28 policies y 7 funciones pasan de `es_admin` a `es_responsable`. Con un centro no NULL las
 *     dos dan lo mismo, y hoy nadie es Dirección sin ser admin: el resto de la suite sigue en verde
 *     sin tocarla. Cuando exista la directora (PR 2), aquí irá lo que ella no puede.
 *   - El cambio declarado: `es_responsable(NULL)` es FALSE, y `es_admin(NULL)` es TRUE para
 *     cualquier admin. Las filas de `usuarios` en `audit_log` llevan `centro_id` NULL: cualquier
 *     admin de cualquier centro leía el nombre y la foto de todos los usuarios.
 *   - `set_datos_acreedor(NULL, …)` daba por buena a cualquier admin (y no actualizaba nada).
 */

// Cliente sin tipar: la prueba pasa un NULL donde los tipos piden un uuid.
type Client = SupabaseClient

let centroA: TestCentro
let adminA: TestUser
let superusuario: TestUser
let cliAdminA: Client
let cliSuper: Client

beforeAll(async () => {
  centroA = await createTestCentro('Centro A Responsable')
  adminA = await createTestUser({ nombre: 'Admin A Responsable' })
  await asignarRol(adminA.id, centroA.id, 'admin')
  cliAdminA = (await clientFor(adminA)) as unknown as Client

  superusuario = await createTestUser({ nombre: 'Superusuario Responsable' })
  const { error: errSuper } = await serviceClient
    .from('platform_admins')
    .insert({ usuario_id: superusuario.id })
  if (errSuper) throw new Error(`sembrar superusuario falló: ${errSuper.message}`)
  cliSuper = (await clientFor(superusuario)) as unknown as Client
}, 120_000)

afterAll(async () => {
  await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
  for (const u of [adminA, superusuario]) if (u) await deleteTestUser(u.id)
  await deleteTestCentro(centroA.id)
}, 60_000)

describe('audit_log: las filas sin centro no las lee nadie con sesión', () => {
  it('premisa: el alta de la admin dejó en audit_log su fila de usuarios, sin centro', async () => {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('centro_id')
      .eq('tabla', 'usuarios')
      .eq('registro_id', adminA.id)
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((f) => f.centro_id === null)).toBe(true)
  })

  it('ancla: la admin sigue leyendo la auditoría de su centro', async () => {
    const { data, error } = await cliAdminA
      .from('audit_log')
      .select('id')
      .eq('tabla', 'roles_usuario')
      .eq('centro_id', centroA.id)
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('la admin no lee las filas de usuarios sin centro (ni la suya)', async () => {
    const { data, error } = await cliAdminA
      .from('audit_log')
      .select('id')
      .eq('tabla', 'usuarios')
      .eq('registro_id', adminA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('el superusuario tampoco', async () => {
    const { data, error } = await cliSuper
      .from('audit_log')
      .select('id')
      .eq('tabla', 'usuarios')
      .eq('registro_id', adminA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})

describe('set_datos_acreedor con centro NULL', () => {
  it('la admin recibe «No autorizado»', async () => {
    const { error } = await cliAdminA.rpc('set_datos_acreedor', {
      p_centro_id: null,
      p_identificador_acreedor: 'ES00ZZZ00000000',
      p_bic_acreedor: 'CAIXESBBXXX',
      p_iban: '',
    })
    expect(error?.message).toBe('No autorizado')
  })
})
