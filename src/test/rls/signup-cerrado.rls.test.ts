import { randomUUID } from 'crypto'

import { afterAll, describe, expect, it } from 'vitest'

import { anonClient, deleteTestUser, serviceClient } from './setup'

/**
 * D5 (auditoría F11-D) — el signup público está CERRADO (ADR-0001: solo por invitación).
 *
 * Con `enable_signup = false` el motor de Auth rechaza `POST /auth/v1/signup` con la anon key
 * (que va en el bundle del navegador). Ningún camino legítimo de NIDO pasa por ahí: todas las
 * cuentas las crea el servidor con la API de admin (`inviteUserByEmail`, `admin.createUser`,
 * `admin.updateUserById`), que GoTrue NO condiciona a `disable_signup` (solo lo miran
 * `signup.go`, `anonymous.go` y los proveedores externos). Este test fija las dos mitades:
 *  - el signup libre se rechaza y NO deja cuenta;
 *  - los caminos legítimos siguen creando cuentas y la recuperación de contraseña sigue viva.
 *
 * Nada aquí manda correo en el remoto: la recuperación se ejercita con `generateLink` (no
 * envía) + `verifyOtp`, el mismo `/verify` que abre el enlace del correo. `inviteUserByEmail`
 * (que sí envía) solo corre en la BD efímera, donde el correo cae en el buzón local.
 *
 * Gateado (la config de producción la cambia Jose en el panel): SIGNUP_CERRADO_APPLIED=1
 */

const SIGNUP_CERRADO = process.env.SIGNUP_CERRADO_APPLIED === '1'
const ES_BD_EFIMERA = /127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')

const PASSWORD = 'Rls-Test-Pass-2026!'
const PASSWORD_NUEVA = 'Rls-Test-Nueva-2026!'

function emailNuevo(): string {
  return `rls-signup-${randomUUID()}@nido.test`
}

async function idPorEmail(email: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .rpc('buscar_auth_user_por_email', { p_email: email })
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

describe.skipIf(!SIGNUP_CERRADO)('D5 — signup público cerrado', () => {
  const creados: string[] = []

  afterAll(async () => {
    for (const id of creados) await deleteTestUser(id)
  })

  it('un signup libre con la anon key se RECHAZA y no deja cuenta', async () => {
    const email = emailNuevo()
    const { data, error } = await anonClient().auth.signUp({ email, password: PASSWORD })

    // Por si el motor lo aceptara (regresión): que la cuenta no quede viva tras el test.
    if (data.user) creados.push(data.user.id)

    expect(error?.code).toBe('signup_disabled')
    expect(data.user).toBeNull()
    expect(await idPorEmail(email)).toBeNull()
  })

  it('admin.createUser (cuenta nueva al aceptar, alta en papel) sigue creando cuentas usables', async () => {
    const email = emailNuevo()
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { nombre_completo: 'Test Signup Cerrado' },
    })
    expect(error).toBeNull()
    expect(data.user).not.toBeNull()
    creados.push(data.user!.id)

    const { data: sesion, error: loginErr } = await anonClient().auth.signInWithPassword({
      email,
      password: PASSWORD,
    })
    expect(loginErr).toBeNull()
    expect(sesion.user?.id).toBe(data.user!.id)
  })

  it('recuperar contraseña sigue funcionando: enlace → /verify → fijar clave → entrar', async () => {
    const email = emailNuevo()
    const { data: alta, error: altaErr } = await serviceClient.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(altaErr).toBeNull()
    creados.push(alta.user!.id)

    // El enlace que manda `resetPasswordForEmail`, sin mandar el correo.
    const { data: link, error: linkErr } = await serviceClient.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    expect(linkErr).toBeNull()

    const cliente = anonClient()
    const { error: verifyErr } = await cliente.auth.verifyOtp({
      type: 'recovery',
      token_hash: link.properties!.hashed_token,
    })
    expect(verifyErr).toBeNull()

    // `/reset-password` → `updateUser({ password })` con la sesión de recuperación.
    const { error: updErr } = await cliente.auth.updateUser({ password: PASSWORD_NUEVA })
    expect(updErr).toBeNull()

    const { error: loginErr } = await anonClient().auth.signInWithPassword({
      email,
      password: PASSWORD_NUEVA,
    })
    expect(loginErr).toBeNull()
  })

  it.skipIf(!ES_BD_EFIMERA)(
    'invitación: inviteUserByEmail crea el stub y aceptar (updateUserById) deja entrar',
    async () => {
      const email = emailNuevo()
      const { data: inv, error: invErr } = await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { token: randomUUID(), rol_objetivo: 'tutor_legal' },
      })
      expect(invErr).toBeNull()
      expect(inv.user).not.toBeNull()
      creados.push(inv.user!.id)

      // Lo que hace `acceptInvitationCore` con un stub: fija la clave y confirma el email.
      const { error: updErr } = await serviceClient.auth.admin.updateUserById(inv.user!.id, {
        password: PASSWORD,
        email_confirm: true,
      })
      expect(updErr).toBeNull()

      const { data: sesion, error: loginErr } = await anonClient().auth.signInWithPassword({
        email,
        password: PASSWORD,
      })
      expect(loginErr).toBeNull()
      expect(sesion.user?.id).toBe(inv.user!.id)
    }
  )
})
