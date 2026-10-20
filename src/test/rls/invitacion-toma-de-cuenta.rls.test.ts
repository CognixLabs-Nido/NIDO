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
 * PR 0a (Fase 4) — una invitación no sirve para quedarse con una cuenta que ya existe.
 *
 * Antes de 20261024120000 (control positivo en el CI del commit 492a965/eddf5e7): la directora
 * leía con su sesión el token de una invitación de su centro, o elegía ella el token al crearla,
 * o cambiaba el email de una invitación cuyo token conocía; y con el token,
 * `acceptInvitationCore` fijaba una contraseña nueva a cualquier cuenta sin roles vivos: quien
 * perdió su rol y el superusuario (ADR-0061).
 *
 * Ahora: la sesión no lee el token ni escribe `invitaciones` (42501), y la aceptación no completa
 * como alta nueva una cuenta que ya operó (`cuenta_ha_operado`). El alta a medias de verdad sigue
 * completándose (control).
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
  // Nace ya retirado: una admin viva por centro, y el centro ya tiene la suya.
  const { error: errRetiro } = await serviceClient.from('roles_usuario').insert({
    usuario_id: exAdmin.id,
    centro_id: centro.id,
    rol: 'admin',
    deleted_at: new Date().toISOString(),
    deleted_reason: 'paso_a_superusuario',
  })
  if (errRetiro) throw new Error(`rol retirado falló: ${errRetiro.message}`)

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

async function tokenDe(id: string): Promise<string> {
  const { data } = await serviceClient.from('invitaciones').select('token').eq('id', id).single()
  return data!.token
}

describe('PR 0a — la invitación no toma una cuenta que ya existe', () => {
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

  it('la directora no lee con su sesión el token, pero sí el resto de la invitación', async () => {
    const id = await invitar(exAdmin.email)
    const c = await clientFor(directora)
    const token = await c.from('invitaciones').select('token').eq('id', id).maybeSingle()
    expect(token.error?.code).toBe('42501')
    // Premisa del 42501: la fila es suya y la lee sin el token (no es la RLS que no la ve).
    const fila = await c.from('invitaciones').select('id, email').eq('id', id).single()
    expect(fila.error).toBeNull()
    expect(fila.data?.email).toBe(exAdmin.email)
  })

  it('ni crea con su sesión una invitación (tampoco con el token que elija)', async () => {
    const c = await clientFor(directora)
    const { error } = await c.from('invitaciones').insert({
      email: `rls-elegido-${randomUUID()}@nido.test`,
      rol_objetivo: 'profe',
      centro_id: centro.id,
      token: randomUUID(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(error?.code).toBe('42501')
  })

  it('ni cambia con su sesión el email de una invitación', async () => {
    const id = await invitar(`rls-propio-${randomUUID()}@nido.test`)
    const c = await clientFor(directora)
    const { error } = await c.from('invitaciones').update({ email: exAdmin.email }).eq('id', id)
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient.from('invitaciones').select('email').eq('id', id).single()
    expect(data?.email).not.toBe(exAdmin.email)
  })

  it('con el token, no fija contraseña a quien perdió su rol', async () => {
    const id = await invitar(exAdmin.email)
    const r = await aceptar(await tokenDe(id), PASS_NUEVA)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.email_already_registered' })
    expect(await puedeEntrar(exAdmin.email, PASS_ORIGINAL)).toBe(true)
    expect(await puedeEntrar(exAdmin.email, PASS_NUEVA)).toBe(false)
  })

  it('ni al superusuario sin roles de centro', async () => {
    const id = await invitar(superSinRoles.email, 'admin')
    const r = await aceptar(await tokenDe(id), PASS_NUEVA)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.email_already_registered' })
    expect(await puedeEntrar(superSinRoles.email, PASS_ORIGINAL)).toBe(true)
    expect(await puedeEntrar(superSinRoles.email, PASS_NUEVA)).toBe(false)
    // Y no se le ha dado ningún rol por el camino.
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('usuario_id', { count: 'exact', head: true })
      .eq('usuario_id', superSinRoles.id)
    expect(count).toBe(0)
  })

  it('cuenta_ha_operado: no la ejecuta la sesión; con service role distingue los tres casos', async () => {
    const c = await clientFor(directora)
    const conSesion = await c.rpc('cuenta_ha_operado', { p_usuario_id: exAdmin.id })
    expect(conSesion.error?.code).toBe('42501')
    for (const [id, esperado] of [
      [exAdmin.id, true],
      [superSinRoles.id, true],
      [stubId, false],
    ] as const) {
      const { data, error } = await serviceClient.rpc('cuenta_ha_operado', { p_usuario_id: id })
      expect(error).toBeNull()
      expect(data).toBe(esperado)
    }
  })

  it('control: el alta a medias de verdad se completa', async () => {
    const id = await invitar(stubEmail)
    const r = await aceptar(await tokenDe(id), PASS_NUEVA)
    expect(r.success).toBe(true)
    expect(await puedeEntrar(stubEmail, PASS_NUEVA)).toBe(true)
  })
})
