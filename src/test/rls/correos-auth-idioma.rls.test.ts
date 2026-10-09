import { randomUUID } from 'node:crypto'

import { afterAll, describe, expect, it } from 'vitest'

import { prepararIdiomaInvitacion } from '@/features/auth/lib/idioma-invitacion'

import { anonClient, clientFor, deleteTestUser, serviceClient, type TestUser } from './setup'

/**
 * Correos de Auth en el idioma de la cuenta (20261010120000 + plantillas por idioma).
 *
 *  1. Sincronización (gate IDIOMA_AUTH_SYNC_APPLIED): cambiar `usuarios.idioma_preferido` —con
 *     service role o con la sesión del propio usuario— copia el idioma a los metadatos de Auth,
 *     que es lo que leen las plantillas.
 *  2. Plantillas (solo en la BD local efímera, donde hay buzón de pruebas: `supabase status`
 *     exporta su URL; contra producción NO se ejecuta, porque mandaría correos de verdad): el GoTrue
 *     REAL renderiza `supabase/templates/{invite,recovery}.html` y los asuntos de `config.toml`.
 *     Se comprueba asunto + cuerpo + enlace en es/va/en y el castellano por defecto.
 */

const SYNC_APPLIED = process.env.IDIOMA_AUTH_SYNC_APPLIED === '1'
const BUZON = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL
const APP = 'http://127.0.0.1:3000'

const usuarios: string[] = []

afterAll(async () => {
  for (const id of usuarios) await deleteTestUser(id)
}, 60_000)

function emailNuevo(prefijo: string): string {
  return `${prefijo}-${randomUUID().slice(0, 8)}@nido.test`
}

async function metadatosIdioma(userId: string): Promise<unknown> {
  const { data } = await serviceClient.auth.admin.getUserById(userId)
  return data.user?.user_metadata?.idioma_preferido
}

describe.skipIf(!SYNC_APPLIED)('idioma_preferido → metadatos de Auth (trigger)', () => {
  it('service role cambia usuarios.idioma_preferido → los metadatos lo siguen', async () => {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: emailNuevo('idioma-svc'),
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    })
    expect(error).toBeNull()
    const id = data.user!.id
    usuarios.push(id)

    const { error: upErr } = await serviceClient
      .from('usuarios')
      .update({ idioma_preferido: 'va' })
      .eq('id', id)
    expect(upErr).toBeNull()
    expect(await metadatosIdioma(id)).toBe('va')
  })

  it('el propio usuario cambia su idioma (usuarios_self_update) → los metadatos lo siguen', async () => {
    const email = emailNuevo('idioma-self')
    const password = `Pw-${randomUUID()}`
    const { data } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: 'Usuario Idioma', idioma_preferido: 'es' },
    })
    const user: TestUser = { id: data.user!.id, email, password }
    usuarios.push(user.id)
    const cliente = await clientFor(user)

    const { error } = await cliente
      .from('usuarios')
      .update({ idioma_preferido: 'en' })
      .eq('id', user.id)
    expect(error).toBeNull()
    expect(await metadatosIdioma(user.id)).toBe('en')
    // Solo toca esa clave: el resto de metadatos sigue.
    const { data: tras } = await serviceClient.auth.admin.getUserById(user.id)
    expect(tras.user?.user_metadata?.nombre_completo).toBe('Usuario Idioma')
  })
})

// ---------------------------------------------------------------------------
// Buzón de pruebas (Mailpit en la CLI actual; Inbucket en las antiguas).
// ---------------------------------------------------------------------------
interface Correo {
  asunto: string
  html: string
}

async function ultimoCorreo(para: string, despuesDe = 0): Promise<Correo> {
  const fin = Date.now() + 15_000
  while (Date.now() < fin) {
    const mailpit = await fetch(
      `${BUZON}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`
    ).catch(() => null)
    if (mailpit?.ok) {
      const lista = (await mailpit.json()) as { messages?: Array<{ ID: string }> }
      const mensajes = lista.messages ?? []
      if (mensajes.length > despuesDe && mensajes[0]) {
        const r = await fetch(`${BUZON}/api/v1/message/${mensajes[0].ID}`)
        const m = (await r.json()) as { Subject: string; HTML: string }
        return { asunto: m.Subject, html: m.HTML }
      }
    } else {
      const buzon = para.split('@')[0]!
      const inbucket = await fetch(`${BUZON}/api/v1/mailbox/${buzon}`).catch(() => null)
      if (inbucket?.ok) {
        const lista = (await inbucket.json()) as Array<{ id: string }>
        const ultimo = lista[lista.length - 1]
        if (lista.length > despuesDe && ultimo) {
          const r = await fetch(`${BUZON}/api/v1/mailbox/${buzon}/${ultimo.id}`)
          const m = (await r.json()) as { subject: string; body: { html: string } }
          return { asunto: m.subject, html: m.body.html }
        }
      }
    }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error(`no llegó el correo a ${para}`)
}

async function contarCorreos(para: string): Promise<number> {
  const r = await fetch(`${BUZON}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`)
  if (!r.ok) return 0
  const lista = (await r.json()) as { messages?: unknown[] }
  return lista.messages?.length ?? 0
}

async function invitar(
  email: string,
  idioma?: 'es' | 'va' | 'en'
): Promise<{ id: string; redirectTo: string }> {
  const redirectTo = `${APP}/${idioma ?? 'es'}/invitation/tok-${randomUUID().slice(0, 8)}`
  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      token: 'tok',
      rol_objetivo: 'tutor_legal',
      centro_nombre: 'Escuela Demo',
      ...(idioma ? { idioma_preferido: idioma } : {}),
    },
  })
  expect(error).toBeNull()
  usuarios.push(data.user!.id)
  return { id: data.user!.id, redirectTo }
}

describe.skipIf(!BUZON)('plantillas de Auth por idioma (GoTrue real, buzón local)', () => {
  describe('invitación', () => {
    it.each([
      ['va', "T'han convidat a NIDO — completa el teu accés", "L'escola infantil t'ha convidat"],
      [
        'en',
        "You've been invited to NIDO — complete your access",
        'Your nursery school has invited you',
      ],
      ['es', 'Te han invitado a NIDO — completa tu acceso', 'La escuela infantil te ha invitado'],
    ] as const)(
      'idioma %s → asunto, cuerpo y enlace en ese idioma',
      async (idioma, asunto, texto) => {
        const email = emailNuevo(`inv-${idioma}`)
        const { redirectTo } = await invitar(email, idioma)

        const correo = await ultimoCorreo(email)
        expect(correo.asunto).toBe(asunto)
        expect(correo.html.replace(/\s+/g, ' ')).toContain(texto.replace(/\s+/g, ' '))
        expect(correo.html).toContain(`href="${redirectTo}"`)
        expect(correo.html).toContain('Escuela Demo')
      }
    )

    it('sin idioma en los metadatos → castellano', async () => {
      const email = emailNuevo('inv-sin')
      await invitar(email)
      const correo = await ultimoCorreo(email)
      expect(correo.asunto).toBe('Te han invitado a NIDO — completa tu acceso')
      expect(correo.html).toContain('Completar mi acceso')
    })

    it('reinvitar una cuenta provisional cambiando el idioma → el correo nuevo sale en el idioma nuevo', async () => {
      const email = emailNuevo('inv-reinv')
      await invitar(email, 'es')
      const primero = await ultimoCorreo(email)
      expect(primero.asunto).toBe('Te han invitado a NIDO — completa tu acceso')

      // Lo que hace sendInvitation antes de reenviar (GoTrue NO aplica los metadatos nuevos).
      expect(await prepararIdiomaInvitacion(serviceClient, email, 'va')).toBe('va')
      await new Promise((res) => setTimeout(res, 1_100))
      const previos = await contarCorreos(email)
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${APP}/va/invitation/tok-reinv`,
        data: { idioma_preferido: 'va' },
      })
      const segundo = await ultimoCorreo(email, previos)
      expect(segundo.asunto).toBe("T'han convidat a NIDO — completa el teu accés")
    })
  })

  describe('recuperar contraseña', () => {
    it.each([
      ['va', 'Restablix la teua contrasenya', 'Restablir la contrasenya'],
      ['en', 'Reset your password', 'Reset password'],
      ['es', 'Restablece tu contraseña', 'Restablecer contrase&ntilde;a'],
    ] as const)('cuenta en %s → asunto y cuerpo en ese idioma', async (idioma, asunto, boton) => {
      const email = emailNuevo(`rec-${idioma}`)
      const { data } = await serviceClient.auth.admin.createUser({
        email,
        password: `Pw-${randomUUID()}`,
        email_confirm: true,
        user_metadata: { idioma_preferido: idioma },
      })
      usuarios.push(data.user!.id)

      const { error } = await anonClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${APP}/${idioma}/reset-password`,
      })
      expect(error).toBeNull()
      const correo = await ultimoCorreo(email)
      expect(correo.asunto).toBe(asunto)
      expect(correo.html).toContain(boton)
      // El enlace pasa por el verify de GoTrue y vuelve a /reset-password.
      expect(correo.html).toContain('/verify?')
      expect(correo.html).toContain('type=recovery')
      const destino = `${APP}/${idioma}/reset-password`
      expect(
        correo.html.includes(encodeURIComponent(destino)) || correo.html.includes(destino)
      ).toBe(true)
    })

    it('cuenta sin idioma en los metadatos → castellano', async () => {
      const email = emailNuevo('rec-sin')
      const { data } = await serviceClient.auth.admin.createUser({
        email,
        password: `Pw-${randomUUID()}`,
        email_confirm: true,
      })
      usuarios.push(data.user!.id)
      await anonClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${APP}/es/reset-password`,
      })
      const correo = await ultimoCorreo(email)
      expect(correo.asunto).toBe('Restablece tu contraseña')
    })
  })
})
