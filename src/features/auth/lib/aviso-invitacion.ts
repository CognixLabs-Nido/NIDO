import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getTranslations } from 'next-intl/server'

import { getAppUrl } from '@/shared/lib/app-url'
import { enviarCorreo } from '@/shared/lib/correo/enviar-correo'
import type { Database } from '@/types/database'

type ServiceClient = SupabaseClient<Database>

const IDIOMAS = ['es', 'en', 'va'] as const
type Idioma = (typeof IDIOMAS)[number]

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** El idioma de la cuenta que recibe el aviso (ADR-0060), o castellano. */
async function idiomaDeLaCuenta(service: ServiceClient, email: string): Promise<Idioma> {
  const { data: cuenta } = await service
    .rpc('buscar_auth_user_por_email', { p_email: email })
    .maybeSingle()
  if (!cuenta) return 'es'
  const { data: usuario } = await service
    .from('usuarios')
    .select('idioma_preferido')
    .eq('id', cuenta.id)
    .maybeSingle()
  const idioma = usuario?.idioma_preferido
  return (IDIOMAS as readonly string[]).includes(idioma ?? '') ? (idioma as Idioma) : 'es'
}

/**
 * Aviso de invitación a una cuenta que YA existe (PR 1 de la Fase 4).
 *
 * `inviteUserByEmail` solo manda correo a un email sin cuenta: con una cuenta confirmada falla
 * con `email_exists`. Antes, `sendInvitation` le contestaba a la directora «este email ya tiene
 * una cuenta» —el oráculo de D4— y la persona no se enteraba de nada. Ahora la invitación le llega
 * igual, por la API de Resend, y la directora ve lo mismo exista o no la cuenta.
 *
 * El correo no lleva el token: la persona entra con su contraseña y acepta en su perfil
 * (`/profile/invitations`), que es donde se enlaza (`acceptPendingInvitationCore`). Solo nombra el
 * centro, nunca al niño.
 *
 * Devuelve si salió. Quien llama no puede dar la invitación por enviada si no salió.
 */
export async function enviarAvisoInvitacion(
  service: ServiceClient,
  params: { email: string; centroNombre: string | null }
): Promise<boolean> {
  const idioma = await idiomaDeLaCuenta(service, params.email)
  const t = await getTranslations({ locale: idioma, namespace: 'auth.invitation.aviso_correo' })
  const enlace = `${getAppUrl()}/${idioma}/profile/invitations`
  const intro = params.centroNombre
    ? t('intro_centro', { centro: params.centroNombre })
    : t('intro_sin_centro')

  const texto = [
    t('saludo'),
    '',
    intro,
    t('como_aceptar'),
    '',
    `${t('boton')}: ${enlace}`,
    '',
    t('no_esperada'),
  ].join('\n')

  const html = `<div style="font-family: Helvetica, Arial, sans-serif; color: #3d4450; max-width: 480px">
  <p style="font-size: 22px; font-weight: 700; color: #1f7a5c">NIDO</p>
  <p>${escaparHtml(t('saludo'))}</p>
  <p>${escaparHtml(intro)}</p>
  <p>${escaparHtml(t('como_aceptar'))}</p>
  <p><a href="${escaparHtml(enlace)}" style="display: inline-block; padding: 12px 24px; background-color: #1f7a5c; color: #ffffff; text-decoration: none; border-radius: 8px">${escaparHtml(t('boton'))}</a></p>
  <p style="font-size: 13px; color: #6b7280">${escaparHtml(t('no_esperada'))}</p>
</div>`

  const r = await enviarCorreo({ para: params.email, asunto: t('asunto'), texto, html })
  return r.enviado
}
