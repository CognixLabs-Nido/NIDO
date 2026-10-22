'use server'

import { revalidatePath } from 'next/cache'

import { enviarCorreoInvitacion } from '@/features/auth/lib/correo-invitacion'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { errorDePlataforma } from '../lib/errores'
import { crearCentroSchema, type CrearCentroInput } from '../schemas/crear-centro'

/**
 * Crea un centro desde la plataforma (Fase 5, PR 2): el centro, su curso y la invitación de su
 * admin, en una transacción (`platform_crear_centro`, que solo deja al superusuario), y después el
 * correo de la invitación. Si el correo no sale, el centro ya está creado: se dice, y se reenvía
 * desde el panel.
 */
export async function crearCentro(
  input: CrearCentroInput
): Promise<ActionResult<{ centroId: string; errorCorreo: string | null }>> {
  const parsed = crearCentroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'plataforma.errores.datos_invalidos')
  }
  const d = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('platform_crear_centro', {
      p_nombre: d.nombre,
      p_direccion: d.direccion,
      p_telefono: d.telefono,
      p_email_contacto: d.email_contacto,
      p_idioma: d.idioma_default,
      p_curso_nombre: d.curso_nombre,
      p_curso_inicio: d.curso_inicio,
      p_curso_fin: d.curso_fin,
      p_email_admin: d.email_admin,
    })
    .single()
  if (error || !data) {
    if (error) logger.warn('crearCentro: platform_crear_centro falló', { code: error.code })
    return fail(error ? errorDePlataforma(error) : 'plataforma.errores.fallo')
  }

  const errorCorreo = await enviarCorreoInvitacion(createServiceRoleClient(), {
    invitationId: data.invitacion_id,
    email: d.email_admin,
    rolObjetivo: 'admin',
    centroId: data.centro_id,
    idioma: d.idioma_default,
  })

  revalidatePath('/[locale]/plataforma', 'page')
  return ok({ centroId: data.centro_id, errorCorreo })
}
