'use server'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { parentescoEnum, permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_OBLIGATORIOS, CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'

import { acceptInvitationSchema, type AcceptInvitationInput } from '../schemas/invitation'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from './_service-role'

type ServiceClient = ReturnType<typeof createServiceRoleClient>

const ROLES_FAMILIA = ['tutor_legal', 'autorizado'] as const

function esRolFamilia(rol: string): boolean {
  return (ROLES_FAMILIA as readonly string[]).includes(rol)
}

/**
 * Crea el vínculo familiar tutor↔niño al aceptar la invitación (auto-vínculo).
 * IDEMPOTENTE: ON CONFLICT (nino_id, usuario_id) DO NOTHING vía upsert con
 * ignoreDuplicates — si el admin ya lo creó a mano (crearVinculo), no falla.
 * El `tipo_vinculo` viene de la invitación; fallback a principal si una invitación
 * tutor_legal antigua viniera con NULL. `permisos` reusa permisosDefault (mismos
 * que el camino admin → consistencia entre ambos caminos).
 */
async function crearVinculoAutomatico(
  service: ServiceClient,
  params: {
    ninoId: string
    usuarioId: string
    rolObjetivo: string
    tipoVinculoInvitacion: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado' | null
    parentesco: string
    descripcionParentesco: string | null
  }
): Promise<{ error: string | null }> {
  const tipo =
    params.tipoVinculoInvitacion ??
    (params.rolObjetivo === 'autorizado' ? 'autorizado' : 'tutor_legal_principal')

  const { error } = await service.from('vinculos_familiares').upsert(
    {
      nino_id: params.ninoId,
      usuario_id: params.usuarioId,
      tipo_vinculo: tipo,
      parentesco: params.parentesco as ReturnType<typeof parentescoEnum.parse>,
      descripcion_parentesco: params.descripcionParentesco,
      permisos: permisosDefault(tipo),
    },
    { onConflict: 'nino_id,usuario_id', ignoreDuplicates: true }
  )
  if (error) {
    logger.warn('auto-vínculo falló', error.message)
    return { error: 'auth.invitation.errors.vinculo_failed' }
  }
  return { error: null }
}

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
      'id, email, rol_objetivo, centro_id, nino_id, aula_id, tipo_vinculo, expires_at, accepted_at, rejected_at'
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

  // Invitación de rol familiar con niño → exige parentesco para el auto-vínculo
  // (lo valida ANTES de crear el usuario, para no tener que hacer rollback).
  const creaVinculo = esRolFamilia(invitation.rol_objetivo) && !!invitation.nino_id
  if (creaVinculo && !parsed.data.parentesco) {
    return fail('vinculo.validation.parentesco_requerido')
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

  // Captura de consentimientos: la tabla `consentimientos` es la fuente de verdad
  // (fila append-only por tipo+versión), y la caché de usuarios se refresca en la
  // MISMA transacción dentro del RPC. Términos + privacidad son obligatorios en el
  // alta. (Imagen → firma F8; datos_medicos → su flujo, no el alta.)
  const { ip, userAgent } = await getRequestContext()
  for (const tipo of CONSENT_OBLIGATORIOS) {
    const { error: consentErr } = await service.rpc('registrar_consentimiento', {
      p_usuario_id: userId,
      p_tipo: tipo,
      p_version: CONSENT_VERSIONS[tipo],
      p_ip: ip ?? undefined,
      p_user_agent: userAgent ?? undefined,
    })
    if (consentErr) {
      // Rollback del usuario recién creado: sin consentimiento no se completa el alta.
      logger.warn('registrar_consentimiento falló', consentErr.message)
      await service.from('roles_usuario').delete().eq('usuario_id', userId)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail('auth.invitation.errors.create_failed')
    }
  }

  // Auto-vínculo tutor↔niño (idempotente). Solo roles familiares con niño.
  if (creaVinculo && invitation.nino_id && parsed.data.parentesco) {
    const { error: vinculoError } = await crearVinculoAutomatico(service, {
      ninoId: invitation.nino_id,
      usuarioId: userId,
      rolObjetivo: invitation.rol_objetivo,
      tipoVinculoInvitacion: invitation.tipo_vinculo,
      parentesco: parsed.data.parentesco,
      descripcionParentesco: parsed.data.descripcionParentesco ?? null,
    })
    if (vinculoError) {
      await service.from('roles_usuario').delete().eq('usuario_id', userId)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail(vinculoError)
    }
  }

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
// `vinculo` recoge el parentesco que declara el usuario; obligatorio cuando la
// invitación es de rol familiar (no necesita consents: ya los dio al registrarse).
export async function acceptPendingInvitation(
  invitationId: string,
  vinculo?: { parentesco?: string; descripcionParentesco?: string | null }
): Promise<ActionResult<{ rol: string }>> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user?.email) return fail('auth.invitation.errors.unauthenticated')

  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select(
      'id, email, rol_objetivo, centro_id, nino_id, tipo_vinculo, expires_at, accepted_at, rejected_at'
    )
    .eq('id', invitationId)
    .maybeSingle()

  if (!invitation) return fail('auth.invitation.errors.invalid')
  if (invitation.email.toLowerCase() !== user.user.email.toLowerCase()) {
    return fail('auth.invitation.errors.email_mismatch')
  }
  if (invitation.accepted_at || invitation.rejected_at)
    return fail('auth.invitation.errors.invalid')
  if (new Date(invitation.expires_at) < new Date()) return fail('auth.invitation.errors.expired')

  // Valida parentesco para rol familiar ANTES de tocar nada.
  const creaVinculo = esRolFamilia(invitation.rol_objetivo) && !!invitation.nino_id
  if (creaVinculo) {
    const parsedParentesco = parentescoEnum.safeParse(vinculo?.parentesco)
    if (!parsedParentesco.success) return fail('vinculo.validation.parentesco_requerido')
    if (parsedParentesco.data === 'otro' && !vinculo?.descripcionParentesco) {
      return fail('vinculo.validation.descripcion_requerida')
    }
  }

  const { error: roleErr } = await service.from('roles_usuario').insert({
    usuario_id: user.user.id,
    centro_id: invitation.centro_id,
    rol: invitation.rol_objetivo,
  })
  if (roleErr) {
    // Ignoramos error si el rol ya existía (UNIQUE constraint).
    if (!roleErr.message.includes('duplicate')) return fail('auth.invitation.errors.role_failed')
  }

  // Auto-vínculo idempotente (mismo que el flujo de nuevo usuario).
  if (creaVinculo && invitation.nino_id && vinculo?.parentesco) {
    const { error: vinculoError } = await crearVinculoAutomatico(service, {
      ninoId: invitation.nino_id,
      usuarioId: user.user.id,
      rolObjetivo: invitation.rol_objetivo,
      tipoVinculoInvitacion: invitation.tipo_vinculo,
      parentesco: vinculo.parentesco,
      descripcionParentesco: vinculo.descripcionParentesco ?? null,
    })
    if (vinculoError) return fail(vinculoError)
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
