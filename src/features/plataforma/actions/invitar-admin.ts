'use server'

import { revalidatePath } from 'next/cache'

import { enviarCorreoInvitacion } from '@/features/auth/lib/correo-invitacion'
import { idiomaCorreoEnum } from '@/features/auth/schemas/invitation'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { lecturaFallidaTrasEscritura } from '@/shared/lib/tras-escritura'

import { errorDePlataforma } from '../lib/errores'
import { invitarAdminSchema, type InvitarAdminInput } from '../schemas/crear-centro'
import { falloDeLectura } from '@/shared/lib/frontera-lectura'

/**
 * Invita a la admin de un centro que no la tiene (Fase 5, PR 2), o reenvía la última invitación
 * sin email. Solo la plataforma: `platform_invitar_admin` empieza por `is_superadmin`, y con una
 * admin viva contesta 55000. Después sale el correo, en el idioma del centro.
 */
export async function invitarAdmin(
  input: InvitarAdminInput
): Promise<ActionResult<{ invitationId: string }>> {
  try {
    const parsed = invitarAdminSchema.safeParse(input)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'plataforma.errores.datos_invalidos')
    }
    const { centroId, email } = parsed.data

    const supabase = await createClient()
    const { data: invitationId, error } = await supabase.rpc('platform_invitar_admin', {
      p_centro_id: centroId,
      p_email: email,
    })
    if (error || !invitationId) {
      if (error) logger.warn('invitarAdmin: platform_invitar_admin falló', { code: error.code })
      return fail(error ? errorDePlataforma(error) : 'plataforma.errores.fallo')
    }

    // A quién y en qué idioma: la invitación que acaba de escribir la RPC y el idioma del centro.
    const service = createServiceRoleClient()
    const [{ data: invitacion, error: errInvitacion }, { data: centro, error: errorLectura }] =
      await Promise.all([
        service.from('invitaciones').select('email').eq('id', invitationId).single(),
        service.from('centros').select('idioma_default').eq('id', centroId).single(),
      ])
    // La invitación ya está escrita: sin el idioma del centro, el correo sale en el idioma por defecto
    // (como antes del censo C) y el fallo va a Sentry. Parar aquí diría «no» sobre algo guardado.
    if (errorLectura) lecturaFallidaTrasEscritura('invitarAdmin: idioma del centro', errorLectura)
    // Sin releerla no hay a quién mandar el correo: el mensaje nombra el síntoma («no se pudo localizar la
    // invitación», cruce lint/censo del 2026-11-25), y el fallo va a Sentry (censo C).
    if (errInvitacion)
      lecturaFallidaTrasEscritura('invitarAdmin: releer la invitación', errInvitacion)
    if (!invitacion) return fail('auth.invitation.errors.lookup_failed')
    const idioma = idiomaCorreoEnum.safeParse(centro?.idioma_default)

    const errorCorreo = await enviarCorreoInvitacion(service, {
      invitationId,
      email: invitacion.email,
      rolObjetivo: 'admin',
      centroId,
      idioma: idioma.success ? idioma.data : undefined,
    })
    revalidatePath('/[locale]/plataforma', 'page')
    if (errorCorreo) return fail(errorCorreo)
    return ok({ invitationId })
  } catch (e) {
    return falloDeLectura(e)
  }
}
