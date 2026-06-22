'use server'

import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/shared/lib/app-url'
import { logger } from '@/shared/lib/logger'

import { sendInvitationSchema, type SendInvitationInput } from '../schemas/invitation'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const INVITATION_TTL_DAYS = 7

export async function sendInvitation(
  input: SendInvitationInput,
  locale: string = 'es'
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = sendInvitationSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'auth.validation.invalid'
    return fail(first)
  }

  // Validar usuario autenticado y que sea admin del centro objetivo.
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return fail('auth.invitation.errors.unauthenticated')

  const { data: callerRoles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', user.user.id)
    .is('deleted_at', null)

  const isAdminOfCentro = callerRoles?.some(
    (r) => r.centro_id === parsed.data.centroId && r.rol === 'admin'
  )
  if (!isAdminOfCentro) {
    return fail('auth.invitation.errors.forbidden')
  }

  const service = createServiceRoleClient()
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Tipo de vínculo a crear al aceptar (auto-vínculo). Coherente con el CHECK de BD:
  // tutor_legal → principal (default) o secundario; autorizado → 'autorizado';
  // admin/profe → NULL (no llevan vínculo familiar).
  const tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado' | null =
    parsed.data.rolObjetivo === 'tutor_legal'
      ? (parsed.data.tipoVinculo ?? 'tutor_legal_principal')
      : parsed.data.rolObjetivo === 'autorizado'
        ? 'autorizado'
        : null

  // Deduplicar: si existe invitación pendiente con mismo email + centro + rol + niño,
  // actualizar. El `nino_id` ES parte de la clave (alta tutor-driven): un mismo tutor
  // puede tener invitaciones abiertas para DOS niños distintos a la vez — sin acotar por
  // niño, la 2.ª invitación clobbearía el `nino_id` de la 1.ª (esqueleto huérfano).
  let dedupeQuery = service
    .from('invitaciones')
    .select('id')
    .eq('email', parsed.data.email)
    .eq('centro_id', parsed.data.centroId)
    .eq('rol_objetivo', parsed.data.rolObjetivo)
    .is('accepted_at', null)
    .is('rejected_at', null)
  dedupeQuery = parsed.data.ninoId
    ? dedupeQuery.eq('nino_id', parsed.data.ninoId)
    : dedupeQuery.is('nino_id', null)
  const { data: existing } = await dedupeQuery.limit(1).maybeSingle()

  let invitationId: string
  if (existing) {
    const { error } = await service
      .from('invitaciones')
      .update({
        expires_at: expiresAt,
        aula_id: parsed.data.aulaId ?? null,
        nino_id: parsed.data.ninoId ?? null,
        tipo_vinculo: tipoVinculo,
      })
      .eq('id', existing.id)
    if (error) return fail('auth.invitation.errors.update_failed')
    invitationId = existing.id
  } else {
    const { data, error } = await service
      .from('invitaciones')
      .insert({
        email: parsed.data.email,
        rol_objetivo: parsed.data.rolObjetivo,
        centro_id: parsed.data.centroId,
        nino_id: parsed.data.ninoId ?? null,
        aula_id: parsed.data.aulaId ?? null,
        tipo_vinculo: tipoVinculo,
        invitado_por: user.user.id,
        expires_at: expiresAt,
      })
      .select('id, token')
      .single()
    if (error || !data) return fail('auth.invitation.errors.insert_failed')
    invitationId = data.id
  }

  const { data: invitation } = await service
    .from('invitaciones')
    .select('token')
    .eq('id', invitationId)
    .single()

  if (!invitation) return fail('auth.invitation.errors.lookup_failed')

  const redirectTo = `${getAppUrl()}/${locale}/invitation/${invitation.token}`

  const { error: emailError } = await service.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo,
    data: { token: invitation.token, rol_objetivo: parsed.data.rolObjetivo },
  })
  if (emailError) {
    logger.warn('inviteUserByEmail error', emailError.message)
    // No abortamos — la invitación queda en BD y se puede reenviar.
  }

  return ok({ invitationId })
}
