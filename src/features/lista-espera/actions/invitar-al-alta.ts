'use server'

import { revalidatePath } from 'next/cache'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { invitarAlAltaSchema, type InvitarAlAltaInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3 "invitar al alta": promociona un prospecto de la lista de espera a alta
 * real, sin importar su posición en la cola. Orquesta (reusando la infra D6):
 *   1. crea un ESQUELETO de niño (centro + nombre + fecha_nacimiento del prospecto),
 *   2. dispara `sendInvitation` (rol_objetivo='tutor_legal', plantilla email neutral),
 *   3. marca el prospecto como `estado='invitado'`.
 *
 * Sin aula ni matrícula (eso lo hace luego la dirección con los flujos existentes).
 * El INSERT del niño va por service role (bypass RLS) → gate admin explícito antes.
 * Si la invitación falla, se deshace el esqueleto (soft delete).
 */
export async function invitarAlAlta(
  input: InvitarAlAltaInput,
  locale: string = 'es'
): Promise<ActionResult<{ ninoId: string; invitationId: string }>> {
  const parsed = invitarAlAltaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (el INSERT del niño va por service role → sin RLS que lo cubra).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  // Prospecto (RLS admin lo acota a su centro). Debe estar en espera y tener email.
  const { data: prospecto } = await supabase
    .from('lista_espera')
    .select('id, centro_id, nombre_nino, fecha_nacimiento, email_tutor, estado')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto || prospecto.centro_id !== centroId)
    return fail('listaEspera.errors.no_encontrado')
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')
  if (!prospecto.email_tutor) return fail('listaEspera.errors.sin_email')

  const service = createServiceRoleClient()

  // 1. Esqueleto de niño (apellidos NULL → los completa el tutor en el wizard).
  const { data: nino, error: ninoErr } = await service
    .from('ninos')
    .insert({
      centro_id: centroId,
      nombre: prospecto.nombre_nino,
      fecha_nacimiento: prospecto.fecha_nacimiento,
    })
    .select('id')
    .single()
  if (ninoErr || !nino) {
    logger.warn('invitarAlAlta nino insert', ninoErr?.message)
    return fail('nino.errors.create_failed')
  }

  // 2. Invitación (reusa sendInvitation: dedupe nino_id-aware + email neutral).
  const inv = await sendInvitation(
    {
      email: prospecto.email_tutor,
      rolObjetivo: 'tutor_legal',
      centroId,
      ninoId: nino.id,
      tipoVinculo: 'tutor_legal_principal',
    },
    locale
  )
  if (!inv.success) {
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail(inv.error)
  }

  // 3. El prospecto pasa a invitado.
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado' })
    .eq('id', prospecto.id)
  if (estadoErr) {
    // La invitación ya salió; no revertimos al tutor. Log y seguimos (el prospecto
    // queda en_espera; reintentar es idempotente vía dedupe de sendInvitation).
    logger.warn('invitarAlAlta estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ ninoId: nino.id, invitationId: inv.data.invitationId })
}
