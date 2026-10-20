import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  isRetryableAuthError,
  serviceClient,
  withRetry,
  type TestCentro,
  type TestUser,
} from './setup'

// La aceptación corre fuera de una petición: cabeceras vacías y sin cookies.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}))

const { acceptInvitationCore } = await import('@/features/auth/actions/accept-invitation')

/**
 * PR 0a — CONTROL POSITIVO del ataque, antes del arreglo (este fichero se invierte en el commit
 * que lo cierra). Una directora invita al email de una cuenta que ya existe y no tiene roles
 * vivos (el superusuario, o quien perdió su rol), lee el token de la invitación con su sesión y
 * acepta: `acceptInvitationCore` la trata como un alta a medias y le fija una contraseña nueva.
 */

const PASS_ORIGINAL = 'Rls-Test-Pass-2026!'
const PASS_NUEVA = 'Toma-De-Cuenta-2026!'

let centro: TestCentro
let directora: TestUser
let exAdmin: TestUser
let superSinRoles: TestUser
let stubId: string
const stubEmail = `rls-stub-${randomUUID()}@nido.test`

async function invitar(email: string, rol: 'profe' | 'admin' = 'profe'): Promise<string> {
  // Lo que deja `sendInvitation`: la fila se inserta antes de que GoTrue diga `email_exists`.
  const { data, error } = await serviceClient
    .from('invitaciones')
    .insert({
      email,
      rol_objetivo: rol,
      centro_id: centro.id,
      invitado_por: directora.id,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`invitar falló: ${error?.message}`)
  return data.id
}

async function puedeEntrar(email: string, password: string): Promise<boolean> {
  const c = anonClient()
  const { error } = await c.auth.signInWithPassword({ email, password })
  return !error
}

function aceptar(token: string, password: string) {
  return acceptInvitationCore({
    token,
    nombreCompleto: 'Atacante Pruebas',
    password,
    idiomaPreferido: 'es',
    aceptaTerminos: true,
    aceptaPrivacidad: true,
  })
}

beforeAll(async () => {
  centro = await createTestCentro('Toma de cuenta')
  directora = await createTestUser({ nombre: 'Directora Toma' })
  await asignarRol(directora.id, centro.id, 'admin')

  // Quien tuvo un rol y lo perdió (como el superusuario tras el relevo de ADR-0061).
  exAdmin = await createTestUser({ nombre: 'Ex Admin Toma' })
  await asignarRol(exAdmin.id, centro.id, 'admin')
  const { error: errRetiro } = await serviceClient
    .from('roles_usuario')
    .update({ deleted_at: new Date().toISOString(), deleted_reason: 'paso_a_superusuario' })
    .eq('usuario_id', exAdmin.id)
  if (errRetiro) throw new Error(`retirar rol falló: ${errRetiro.message}`)

  // Un superusuario que nunca tuvo rol de centro.
  superSinRoles = await createTestUser({ nombre: 'Super Toma' })
  const { error: errSuper } = await serviceClient
    .from('platform_admins')
    .insert({ usuario_id: superSinRoles.id })
  if (errSuper) throw new Error(`sembrar superusuario falló: ${errSuper.message}`)

  // El alta a medias de verdad: la cuenta que crea `inviteUserByEmail`, sin contraseña.
  stubId = await withRetry(
    async () => {
      const { data, error } = await serviceClient.auth.admin.createUser({
        email: stubEmail,
        email_confirm: false,
      })
      if (error || !data.user) throw error ?? new Error('stub sin usuario')
      return data.user.id
    },
    { shouldRetry: isRetryableAuthError }
  )
})

afterAll(async () => {
  await serviceClient.from('platform_admins').delete().eq('usuario_id', superSinRoles.id)
  await serviceClient.from('invitaciones').delete().eq('centro_id', centro.id)
  for (const id of [directora.id, exAdmin.id, superSinRoles.id, stubId]) await deleteTestUser(id)
  await deleteTestCentro(centro.id)
})

describe('PR 0a — control positivo: el ataque funciona hoy', () => {
  it('premisa: las cuentas existen, sin roles vivos, y entran con su contraseña', async () => {
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('usuario_id', { count: 'exact', head: true })
      .in('usuario_id', [exAdmin.id, superSinRoles.id])
      .is('deleted_at', null)
    expect(count).toBe(0)
    expect(await puedeEntrar(exAdmin.email, PASS_ORIGINAL)).toBe(true)
    expect(await puedeEntrar(superSinRoles.email, PASS_ORIGINAL)).toBe(true)
  })

  it('la directora lee con su sesión el token de una invitación de su centro', async () => {
    const id = await invitar(exAdmin.email)
    const c = await clientFor(directora)
    const { data, error } = await c.from('invitaciones').select('token').eq('id', id).single()
    expect(error).toBeNull()
    expect(data?.token).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('con ese token fija una contraseña nueva a quien perdió su rol', async () => {
    const id = await invitar(exAdmin.email)
    const c = await clientFor(directora)
    const { data } = await c.from('invitaciones').select('token').eq('id', id).single()
    const r = await aceptar(data!.token, PASS_NUEVA)
    expect(r.success).toBe(true)
    expect(await puedeEntrar(exAdmin.email, PASS_NUEVA)).toBe(true)
    expect(await puedeEntrar(exAdmin.email, PASS_ORIGINAL)).toBe(false)
  })

  it('y al superusuario sin roles de centro', async () => {
    const id = await invitar(superSinRoles.email)
    const c = await clientFor(directora)
    const { data } = await c.from('invitaciones').select('token').eq('id', id).single()
    const r = await aceptar(data!.token, PASS_NUEVA)
    expect(r.success).toBe(true)
    expect(await puedeEntrar(superSinRoles.email, PASS_NUEVA)).toBe(true)
  })

  it('o crea con su sesión una invitación con el token que elige ella', async () => {
    const elegido = randomUUID()
    const c = await clientFor(directora)
    const { data, error } = await c
      .from('invitaciones')
      .insert({
        email: `rls-elegido-${randomUUID()}@nido.test`,
        rol_objetivo: 'profe',
        centro_id: centro.id,
        token: elegido,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('token')
      .single()
    expect(error).toBeNull()
    expect(data?.token).toBe(elegido)
  })

  it('o cambia con su sesión el email de una invitación cuyo token ya conoce', async () => {
    const id = await invitar(`rls-propio-${randomUUID()}@nido.test`)
    const c = await clientFor(directora)
    const { data, error } = await c
      .from('invitaciones')
      .update({ email: exAdmin.email })
      .eq('id', id)
      .select('email')
      .single()
    expect(error).toBeNull()
    expect(data?.email).toBe(exAdmin.email)
  })

  it('control: el alta a medias de verdad se completa', async () => {
    const id = await invitar(stubEmail)
    const { data } = await serviceClient.from('invitaciones').select('token').eq('id', id).single()
    const r = await aceptar(data!.token, PASS_NUEVA)
    expect(r.success).toBe(true)
    expect(await puedeEntrar(stubEmail, PASS_NUEVA)).toBe(true)
  })
})
