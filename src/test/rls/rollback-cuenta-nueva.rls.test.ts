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
 * B2 (censo C; decisiones de Jose del 2026-11-27). Medido abierto antes con este fichero (runs 45965561775 y
 * 45966559012): «el fallo que abre el agujero no es el borrado de los roles, es el deleteUser tragado, y en
 * los tres casos la acción responde "create_failed"… le dice a Dirección que la cuenta no se creó, y la
 * cuenta existe, tiene rol de profe y puede entrar». Ahora (`deshacerCuentaNueva`): `deleteUser` primero y
 * mirado; si falla, se retiran los roles (mirado) y se BLOQUEA la cuenta en Auth, y lo que quede a medias va
 * a Sentry. «Bloquear la cuenta en Auth es la pieza que cierra el peor caso» (Jose). Contra la base efímera y
 * el GoTrue del CI; lo único simulado: `registrar_consentimiento` contesta error (para entrar en el
 * rollback), el DELETE de `roles_usuario` y `auth.admin.deleteUser`. Fixtures ficticios del 2026-11-27.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}))

const authFalla = vi.hoisted(() => ({ deleteUser: false }))
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
      const service = real.createServiceRoleClient()
      // `auth.admin.deleteUser` que contesta error, como lo haría GoTrue (el código lo traga con .catch).
      const admin = service.auth.admin
      const deleteUser = admin.deleteUser.bind(admin)
      admin.deleteUser = (async (id: string, soft?: boolean) =>
        authFalla.deleteUser
          ? { data: { user: null }, error: { message: 'deleteUser: fallo simulado', status: 500 } }
          : deleteUser(id, soft)) as typeof admin.deleteUser
      fallos.actual = service
      return clienteConFallos(fallos)
    },
  }
})

const { acceptInvitationCore } = await import('@/features/auth/actions/accept-invitation')
const { logger } = await import('@/shared/lib/logger')
// Lo que va a Sentry (`logger.error`): se espía, sin cambiar lo que hace.
const errores = vi.spyOn(logger, 'error')

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

describe('el rollback de la cuenta nueva: una cuenta que se deshace no queda con la que entrar (B2)', () => {
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

  it('con el borrado de los roles fallando: deleteUser va primero y se lleva la cuenta y sus roles', async () => {
    const inv = await invitar()
    fallos.fallaRpc = 'registrar_consentimiento'
    fallos.fallaEscrituraTabla = 'roles_usuario'
    fallos.fallidas = 0
    const r = await aceptar(inv.token)
    fallos.fallaRpc = null
    fallos.fallaEscrituraTabla = null
    expect(fallos.fallidas, 'premisa: el consentimiento falló').toBeGreaterThan(0)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.create_failed' })
    expect(await loQueQueda(inv)).toEqual({
      cuentaAuth: false,
      rolesVivos: 0,
      entra: false,
      aceptada: false,
    })
  })

  it('si falla deleteUser: la cuenta queda sin roles y BLOQUEADA (no entra), y Sentry lo sabe', async () => {
    const inv = await invitar()
    fallos.fallaRpc = 'registrar_consentimiento'
    authFalla.deleteUser = true
    fallos.fallidas = 0
    errores.mockClear()
    const r = await aceptar(inv.token)
    fallos.fallaRpc = null
    authFalla.deleteUser = false
    expect(fallos.fallidas, 'premisa: el consentimiento falló').toBeGreaterThan(0)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.create_failed' })
    const queda = await loQueQueda(inv)
    // Premisa: deleteUser falló de verdad (la cuenta sigue en Auth).
    expect(queda.cuentaAuth, '¿sigue la cuenta de Auth?').toBe(true)
    expect(queda).toEqual({ cuentaAuth: true, rolesVivos: 0, entra: false, aceptada: false })
    expect(errores).toHaveBeenCalledWith(
      'cuenta nueva sin deshacer (accept: consentimiento)',
      expect.objectContaining({ borrada: false, roles_retirados: true, bloqueada: true })
    )
  })

  it('si fallan los dos (deleteUser y el borrado de roles): conserva el rol pero NO entra, y Sentry lo sabe', async () => {
    const inv = await invitar()
    fallos.fallaRpc = 'registrar_consentimiento'
    fallos.fallaEscrituraTabla = 'roles_usuario'
    authFalla.deleteUser = true
    fallos.fallidas = 0
    errores.mockClear()
    const r = await aceptar(inv.token)
    fallos.fallaRpc = null
    fallos.fallaEscrituraTabla = null
    authFalla.deleteUser = false
    expect(
      fallos.fallidas,
      'premisa: el consentimiento y el borrado de los roles fallaron'
    ).toBeGreaterThanOrEqual(2)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.create_failed' })
    const queda = await loQueQueda(inv)
    expect(queda.cuentaAuth, 'premisa: deleteUser falló (la cuenta sigue)').toBe(true)
    expect(queda).toEqual({ cuentaAuth: true, rolesVivos: 1, entra: false, aceptada: false })
    expect(errores).toHaveBeenCalledWith(
      'cuenta nueva sin deshacer (accept: consentimiento)',
      expect.objectContaining({ borrada: false, roles_retirados: false, bloqueada: true })
    )
  })
})
