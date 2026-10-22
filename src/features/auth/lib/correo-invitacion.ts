import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getAppUrl } from '@/shared/lib/app-url'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { enviarAvisoInvitacion } from './aviso-invitacion'
import { prepararIdiomaInvitacion } from './idioma-invitacion'
import { llamarGoTrue } from './llamar-gotrue'
import type { IdiomaCorreo } from '../schemas/invitation'

type ServiceClient = SupabaseClient<Database>

/**
 * Manda el correo de una invitación ya escrita en `invitaciones`: el de GoTrue con el enlace del
 * token, o el aviso por Resend si la cuenta ya existe (PR 1 de la Fase 4). Lo usan `sendInvitation`
 * y la invitación de admin de la plataforma (Fase 5). Devuelve `null` si el correo salió, o la
 * clave del error.
 */
export async function enviarCorreoInvitacion(
  service: ServiceClient,
  datos: {
    invitationId: string
    email: string
    rolObjetivo: Database['public']['Enums']['user_role']
    centroId: string
    idioma?: IdiomaCorreo
  }
): Promise<string | null> {
  const { data: invitation } = await service
    .from('invitaciones')
    .select('token')
    .eq('id', datos.invitationId)
    .single()

  if (!invitation) return 'auth.invitation.errors.lookup_failed'

  // Nombre del centro para personalizar la firma del email ({{ .Data.centro_nombre }}
  // en la plantilla de invitación). Si faltara, la plantilla cae a "la escuela".
  const { data: centro } = await service
    .from('centros')
    .select('nombre')
    .eq('id', datos.centroId)
    .maybeSingle()

  // Idioma del correo y de la página del enlace (elegido por la Dirección, el de la cuenta
  // provisional si es un reenvío, o castellano). Ajusta la cuenta provisional si hace falta.
  const idioma = await prepararIdiomaInvitacion(service, datos.email, datos.idioma)

  const redirectTo = `${getAppUrl()}/${idioma}/invitation/${invitation.token}`

  const { error: emailError, indisponible: emailIndisponible } = await llamarGoTrue(
    'inviteUserByEmail',
    () =>
      service.auth.admin.inviteUserByEmail(datos.email, {
        redirectTo,
        data: {
          token: invitation.token,
          rol_objetivo: datos.rolObjetivo,
          centro_nombre: centro?.nombre ?? null,
          // Lo lee la plantilla (`.Data.idioma_preferido`) y `handle_new_user` lo copia a
          // `usuarios.idioma_preferido` al crear la cuenta provisional.
          idioma_preferido: idioma,
        },
      })
  )
  // PR-A: dejar de reportar éxito falso. Si el email NO salió, se devuelve `fail` para que la
  // UI lo muestre (afecta a TODOS los callers de sendInvitation — corrección consistente del
  // mismo bug).
  if (emailIndisponible) return 'auth.invitation.errors.servicio_cuentas_no_disponible'
  if (emailError) {
    // Cuenta que ya existe (de otro centro, personal, superusuario…): GoTrue no le manda nada.
    // PR 1 (Fase 4): le llega el aviso por Resend y acepta desde su perfil. Quien invita ve lo
    // mismo que con un email sin cuenta —«enviada» o «no se pudo enviar»—, nunca «ya tiene
    // cuenta» (D4).
    if (emailError.code === 'email_exists' || emailError.status === 422) {
      const avisada = await enviarAvisoInvitacion(service, {
        email: datos.email,
        centroNombre: centro?.nombre ?? null,
      })
      if (!avisada) return 'auth.invitation.errors.email_no_enviado'
      return null
    }
    logger.warn('inviteUserByEmail error', emailError.message)
    return 'auth.invitation.errors.email_no_enviado'
  }

  return null
}
