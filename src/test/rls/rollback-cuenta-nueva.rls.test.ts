import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { clienteConFallos, type SesionConFallos } from './lectura-fallida'
import {
  anonClient,
  asignarRol,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * MEDIDO ABIERTO (censo C, B2, decisión de Jose del 2026-11-27): «El rollback de la cuenta nueva: hoy un fallo
 * al borrar los roles deja una cuenta que se va a borrar con roles puestos». `acceptInvitationCore` crea la
 * cuenta, le da el rol y, si algo de después falla, la deshace: `retirarRolesDeCuentaNueva` (cuyo resultado se
 * tira) y `auth.admin.deleteUser` (con `.catch(() => {})`). Contra la base efímera de verdad; lo único simulado:
 * `registrar_consentimiento` contesta error (para entrar en el rollback) y, en el caso medido, el DELETE de
 * `roles_usuario`. Fixtures ficticios del 2026-11-27.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}))

const fallos = vi.hoisted(
  () =>
    ({
      actual: null,
      fallaTabla: null,
      fallaRpc: null,
      fallidas: 0,
      fallaEscrituraTabla: null,
    }) as SesionConFallos
)
vi.mock('@/lib/supabase/admin', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/supabase/admin')>()
  return {
    ...real,
    createServiceRoleClient: () => {
      fallos.actual = real.createServiceRoleClient()
      return clienteConFallos(fallos)
    },
  }
})

const { acceptInvitationCore } = await import('@/features/auth/actions/accept-invitation')

const PASS = 'Rollback-Cuenta-2026!'
let centro: TestCentro
let directora: TestUser
const cuentasCreadas: string[] = []

async function invitar(): Promise<{ id: string; email: string; token: string }> {
  const email = `rollback-${randomUUID()}@nido.test`
  const { data, error } = await serviceClient
    .from('invitaciones')
    .insert({
      email,
      rol_objetivo: 'profe',
      centro_id: centro.id,
      invitado_por: directora.id,
      nombre_completo: 'Profe Rollback',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id, token')
    .single()
  if (error || !data) throw new Error(`invitar falló: ${error?.message}`)
  return { id: data.id, email, token: data.token }
}

/** Lo que deja el rollback: roles vivos, la cuenta de Auth, si entra y si la invitación se aceptó. */
async function loQueQueda(inv: { id: string; email: string }) {
  const { data: users } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
  const auth = users?.users.find((u) => u.email === inv.email) ?? null
  if (auth) cuentasCreadas.push(auth.id)
  const { count: rolesVivos } = auth
    ? await serviceClient
        .from('roles_usuario')
        .select('usuario_id', { count: 'exact', head: true })
        .eq('usuario_id', auth.id)
        .is('deleted_at', null)
    : { count: 0 }
  const { error: errEntrar } = await anonClient().auth.signInWithPassword({
    email: inv.email,
    password: PASS,
  })
  const { data: invFila } = await serviceClient
    .from('invitaciones')
    .select('accepted_at')
    .eq('id', inv.id)
    .single()
  return {
    cuentaAuth: auth !== null,
    rolesVivos: rolesVivos ?? 0,
    entra: !errEntrar,
    aceptada: invFila?.accepted_at != null,
  }
}

function aceptar(token: string) {
  return acceptInvitationCore({
    token,
    nombreCompleto: 'Profe Rollback',
    password: PASS,
    idiomaPreferido: 'es',
    aceptaTerminos: true,
    aceptaPrivacidad: true,
  })
}

beforeAll(async () => {
  centro = await createTestCentro('Centro Rollback Cuenta')
  directora = await createTestUser({ nombre: 'Directora Rollback' })
  await asignarRol(directora.id, centro.id, 'admin')
}, 90_000)

afterAll(async () => {
  await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
  for (const id of [directora.id, ...cuentasCreadas]) await deleteTestUser(id)
  await deleteTestCentro(centro.id)
}, 90_000)

describe('el rollback de la cuenta nueva: una cuenta que se deshace no se queda con roles (medido abierto)', () => {
  it('control: si solo falla el consentimiento, no queda cuenta, ni roles, ni entra', async () => {
    const inv = await invitar()
    fallos.fallaRpc = 'registrar_consentimiento'
    fallos.fallaEscrituraTabla = null
    fallos.fallidas = 0
    const r = await aceptar(inv.token)
    fallos.fallaRpc = null
    expect(fallos.fallidas, 'premisa: el consentimiento falló de verdad').toBeGreaterThan(0)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.create_failed' })
    expect(await loQueQueda(inv)).toEqual({
      cuentaAuth: false,
      rolesVivos: 0,
      entra: false,
      aceptada: false,
    })
  })

  it('con el borrado de los roles fallando: lo que queda (los cuatro se miden)', async () => {
    const inv = await invitar()
    fallos.fallaRpc = 'registrar_consentimiento'
    fallos.fallaEscrituraTabla = 'roles_usuario'
    fallos.fallidas = 0
    const r = await aceptar(inv.token)
    fallos.fallaRpc = null
    fallos.fallaEscrituraTabla = null
    expect(
      fallos.fallidas,
      'premisa: el consentimiento y el borrado fallaron'
    ).toBeGreaterThanOrEqual(2)
    const queda = await loQueQueda(inv)
    expect.soft(r, 'lo que contesta la acción').toEqual({
      success: false,
      error: 'auth.invitation.errors.create_failed',
    })
    expect.soft(queda.rolesVivos, 'roles vivos de la cuenta deshecha').toBe(0)
    expect.soft(queda.cuentaAuth, '¿sigue la cuenta de Auth?').toBe(false)
    expect.soft(queda.entra, '¿entra con su contraseña?').toBe(false)
    expect.soft(queda.aceptada, '¿la invitación quedó aceptada?').toBe(false)
    // Para el informe: el estado entero, en el log.
    console.warn('rollback con el borrado de roles fallando:', JSON.stringify({ r, queda }))
  })
})
