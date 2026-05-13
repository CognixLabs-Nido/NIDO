'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { acceptInvitationSchema, type AcceptInvitationInput } from '../schemas/invitation'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from './_service-role'

const CONSENT_VERSION = 'v1.0'

// Acepta invitación para un email nuevo (flujo B2): crea usuario, login automático.
export async function acceptInvitation(
  input: AcceptInvitationInput
): Promise<ActionResult<{ userId: string; primaryRole: string }>> {
  const parsed = acceptInvitationSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'auth.validation.invalid'
    return fail(first)
  }

  const service = createServiceRoleClient()
  const { data: invitation, error: invErr } = await service
    .from('invitaciones')
    .select(
      'id, email, rol_objetivo, centro_id, nino_id, aula_id, expires_at, accepted_at, rejected_at'
    )
    .eq('token', parsed.data.token)
    .maybeSingle()

  if (invErr || !invitation) return fail('auth.invitation.errors.invalid')
  if (invitation.accepted_at || invitation.rejected_at) {
    return fail('auth.invitation.errors.invalid')
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return fail('auth.invitation.errors.expired')
  }

  // Verifica que el email NO existe (en B8 se gestiona por separado).
  const { data: existing } = await service.auth.admin.listUsers()
  const alreadyExists = existing.users.some(
    (u) => u.email?.toLowerCase() === invitation.email.toLowerCase()
  )
  if (alreadyExists) return fail('auth.invitation.errors.email_already_registered')

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: invitation.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      nombre_completo: parsed.data.nombreCompleto,
      idioma_preferido: parsed.data.idiomaPreferido,
    },
  })
  if (createErr || !created.user) {
    logger.warn('createUser failed', createErr?.message)
    return fail('auth.invitation.errors.create_failed')
  }

  const userId = created.user.id

  const { error: roleErr } = await service.from('roles_usuario').insert({
    usuario_id: userId,
    centro_id: invitation.centro_id,
    rol: invitation.rol_objetivo,
  })
  if (roleErr) {
    await service.auth.admin.deleteUser(userId).catch(() => {})
    return fail('auth.invitation.errors.role_failed')
  }

  await service
    .from('usuarios')
    .update({
      consentimiento_terminos_version: CONSENT_VERSION,
      consentimiento_privacidad_version: CONSENT_VERSION,
    })
    .eq('id', userId)

  await service
    .from('invitaciones')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)

  // Login automático en el contexto del request actual.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  })
  if (signInErr) {
    logger.warn('signIn tras accept-invitation falló', signInErr.message)
  }

  return ok({ userId, primaryRole: invitation.rol_objetivo })
}

// Acepta una invitación pendiente para un usuario YA autenticado (flujo B8).
export async function acceptPendingInvitation(
  invitationId: string
): Promise<ActionResult<{ rol: string }>> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user?.email) return fail('auth.invitation.errors.unauthenticated')

  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select('id, email, rol_objetivo, centro_id, expires_at, accepted_at, rejected_at')
    .eq('id', invitationId)
    .maybeSingle()

  if (!invitation) return fail('auth.invitation.errors.invalid')
  if (invitation.email.toLowerCase() !== user.user.email.toLowerCase()) {
    return fail('auth.invitation.errors.email_mismatch')
  }
  if (invitation.accepted_at || invitation.rejected_at)
    return fail('auth.invitation.errors.invalid')
  if (new Date(invitation.expires_at) < new Date()) return fail('auth.invitation.errors.expired')

  const { error: roleErr } = await service.from('roles_usuario').insert({
    usuario_id: user.user.id,
    centro_id: invitation.centro_id,
    rol: invitation.rol_objetivo,
  })
  if (roleErr) {
    // Ignoramos error si el rol ya existía (UNIQUE constraint).
    if (!roleErr.message.includes('duplicate')) return fail('auth.invitation.errors.role_failed')
  }

  await service
    .from('invitaciones')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)

  return ok({ rol: invitation.rol_objetivo })
}

export async function rejectPendingInvitation(invitationId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user?.email) return fail('auth.invitation.errors.unauthenticated')

  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select('id, email, accepted_at, rejected_at')
    .eq('id', invitationId)
    .maybeSingle()

  if (!invitation) return fail('auth.invitation.errors.invalid')
  if (invitation.email.toLowerCase() !== user.user.email.toLowerCase()) {
    return fail('auth.invitation.errors.email_mismatch')
  }
  if (invitation.accepted_at || invitation.rejected_at)
    return fail('auth.invitation.errors.invalid')

  await service
    .from('invitaciones')
    .update({ rejected_at: new Date().toISOString() })
    .eq('id', invitation.id)

  return ok(undefined)
}

// Notifica al usuario existente que tiene una invitación pendiente (flujo B8).
export async function notifyExistingAccountInvitation(token: string): Promise<ActionResult<void>> {
  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select('email, accepted_at, rejected_at, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!invitation || invitation.accepted_at || invitation.rejected_at) {
    return fail('auth.invitation.errors.invalid')
  }
  if (new Date(invitation.expires_at) < new Date()) return fail('auth.invitation.errors.expired')

  // Email de aviso sin token clicable (es solo informativo).
  // Reusamos resetPasswordForEmail como vehículo de transporte de email transaccional no es ideal,
  // pero Supabase Auth built-in no expone un endpoint de "email genérico". En Ola 2 con Resend
  // mandaremos un email plano específico. Por ahora se loggea y se confía en el banner post-login.
  logger.info('notifyExistingAccountInvitation', { emailHashSent: true })
  return ok(undefined)
}
