'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { parentescoEnum, permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createClient } from '@/lib/supabase/server'
import { CONSENT_OBLIGATORIOS, CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { clasificarCuenta } from '../lib/clasificar-cuenta'
import { crearVinculoProfeAula } from '../lib/vincular-profe-aula'
import { acceptInvitationSchema, type AcceptInvitationInput } from '../schemas/invitation'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'

type ServiceClient = SupabaseClient<Database>

const ROLES_FAMILIA = ['tutor_legal', 'autorizado'] as const

function esRolFamilia(rol: string): boolean {
  return (ROLES_FAMILIA as readonly string[]).includes(rol)
}

// Subconjunto de `tipo_vinculo` que representa un vínculo familiar real. El ENUM ganó
// el valor 'admin' (F11 "Completa Dirección"), que solo se usa como `rol_firmante` en
// `firmas_autorizacion` (quién firmó) y NUNCA es un vínculo de `vinculos_familiares` ni
// de una invitación. Este helper estrecha el valor leído de la invitación a ese
// subconjunto antes de pasarlo al auto-vínculo (no cambia el comportamiento: una
// invitación jamás trae 'admin'; la rama es defensiva y cae al fallback por rol).
type TipoVinculoFamiliar = 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'

function narrowTipoVinculoInvitacion(
  tipo: Database['public']['Enums']['tipo_vinculo'] | null
): TipoVinculoFamiliar | null {
  return tipo === 'admin' ? null : tipo
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
    tipoVinculoInvitacion: TipoVinculoFamiliar | null
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
// En ÉXITO redirige server-side al panel (ver `acceptInvitation`): con `updateSession`
// en el proxy, el middleware refresca/propaga la cookie de sesión recién creada por
// `signInWithPassword`, así que el gate del destino (P3c en /family → /alta) ya ve al
// tutor. Sustituye al band-aid `window.location.assign` (4910fbc) y mata el flash
// "enlace inválido" (la ruta token ya no se re-renderiza tras la mutación).
//
// `acceptInvitationCore` hace todo MENOS el `redirect`: devuelve `{ rol, usuarioId }`
// para que el camino con avatar opcional (F11-C-3) pueda subir la foto tras crear la
// cuenta (ya hay sesión) y luego redirigir server-side con `redirigirAlPanel`. El
// camino SIN avatar usa el wrapper `acceptInvitation` (un solo round-trip, sin cambios).
export async function acceptInvitationCore(
  input: AcceptInvitationInput
): Promise<ActionResult<{ rol: string; usuarioId: string }>> {
  const parsed = acceptInvitationSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'auth.validation.invalid'
    return fail(first)
  }

  const service = createServiceRoleClient()
  const { data: invitation, error: invErr } = await service
    .from('invitaciones')
    .select(
      'id, email, rol_objetivo, centro_id, nino_id, aula_id, tipo_personal_aula, tipo_vinculo, expires_at, accepted_at, rejected_at'
    )
    .eq('token', parsed.data.token)
    .maybeSingle()

  if (invErr) logger.warn('accept: lookup de invitación falló', invErr.message)
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

  // Clasifica la cuenta auth del email. `inviteUserByEmail` (enviado por
  // `sendInvitation`) PRE-CREA un STUB en auth.users sin roles → aquí hay que
  // COMPLETARLO, no crear de cero (createUser fallaría con "ya registrado"). Solo una
  // cuenta REAL (con roles) se rechaza: esa va por B8 (acceptPendingInvitation).
  const { data: existing } = await service.auth.admin.listUsers()
  const authUser = existing.users.find(
    (u) => u.email?.toLowerCase() === invitation.email.toLowerCase()
  )
  let tieneRoles = false
  if (authUser) {
    const { data: rolesPrevios } = await service
      .from('roles_usuario')
      .select('usuario_id')
      .eq('usuario_id', authUser.id)
      .is('deleted_at', null)
      .limit(1)
    tieneRoles = (rolesPrevios?.length ?? 0) > 0
  }
  const clase = clasificarCuenta(Boolean(authUser), tieneRoles)
  if (clase === 'real') return fail('auth.invitation.errors.email_already_registered')

  let userId: string
  if (clase === 'stub' && authUser) {
    // Completa el stub de `inviteUserByEmail`: fija la password real (sobrescribe el
    // hash placeholder —bcrypt de secreto random, no usable—), confirma email y metadata.
    const { data: updated, error: updateErr } = await service.auth.admin.updateUserById(
      authUser.id,
      {
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: {
          nombre_completo: parsed.data.nombreCompleto,
          idioma_preferido: parsed.data.idiomaPreferido,
        },
      }
    )
    if (updateErr || !updated.user) {
      logger.warn('updateUserById (completar stub) failed', updateErr?.message)
      return fail('auth.invitation.errors.create_failed')
    }
    userId = updated.user.id
  } else {
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
    userId = created.user.id
  }

  // F-2b-2b: enlazar la cuenta recién activada al perfil `familia_tutores` que se creó al
  // INVITAR con `usuario_id` NULL. La RPC no pudo ponerlo entonces: crear el rol al invitar
  // habría marcado la cuenta como 'real' y roto el routing de la invitación. El id NO cambia
  // (el stub se completó in situ); esto solo rellena el hueco: `usuario_id` + `nombre_completo`
  // (que `lista_espera` no tenía al invitar). El UPDATE de `usuario_id` está EXENTO del
  // congelado de F-2a por ser `service_role` (el caso previsto). Solo altas por invitación de
  // rol familiar con niño.
  //
  // El perfil se identifica por el EMAIL de la invitación (único por tutor), NO por "el primer
  // NULL de la familia": con 2 tutores pendientes (F-2b-2c) cada accept debe enlazar el SUYO,
  // nunca el del otro. Ningún fallo se traga: familia/perfil no resueltos, o un UPDATE que no
  // toca su fila (0 filas por carrera), revierten la activación (deleteUser) y devuelven error
  // visible — mismo principio que el rollback de rol/consents más abajo (PR-A: sin éxito falso).
  if (creaVinculo && invitation.nino_id) {
    const emailInv = invitation.email.trim().toLowerCase()

    const { data: ninoFam, error: ninoFamErr } = await service
      .from('ninos')
      .select('familia_id')
      .eq('id', invitation.nino_id)
      .maybeSingle()
    if (ninoFamErr || !ninoFam?.familia_id) {
      logger.warn('backfill: familia del niño no resuelta', ninoFamErr?.message)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail('auth.invitation.errors.create_failed')
    }

    // Candidatos pendientes de la familia; se casa por email en minúsculas (evita los
    // comodines `_`/`%` de `ilike` y las diferencias de mayúsculas). El email se escribió en
    // `familia_tutores` al invitar (RPC: `p_tutor_email`).
    const { data: perfiles, error: perfilesErr } = await service
      .from('familia_tutores')
      .select('id, email')
      .eq('familia_id', ninoFam.familia_id)
      .is('usuario_id', null)
    if (perfilesErr) {
      logger.warn('backfill: lookup de perfil falló', perfilesErr.message)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail('auth.invitation.errors.create_failed')
    }
    const perfil = perfiles?.find((p) => (p.email ?? '').trim().toLowerCase() === emailInv)
    if (!perfil) {
      logger.warn('backfill: perfil pendiente no encontrado por email')
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail('auth.invitation.errors.create_failed')
    }

    const { data: linked, error: backfillErr } = await service
      .from('familia_tutores')
      .update({ usuario_id: userId, nombre_completo: parsed.data.nombreCompleto })
      .eq('id', perfil.id)
      .is('usuario_id', null)
      .select('id')
      .maybeSingle()
    if (backfillErr || !linked) {
      // Error, o 0 filas (otra sesión lo enlazó entre el SELECT y el UPDATE): NO seguir mudo.
      logger.warn('backfill familia_tutores.usuario_id falló', backfillErr?.message)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail('auth.invitation.errors.create_failed')
    }
  }

  const { error: roleErr } = await service.from('roles_usuario').insert({
    usuario_id: userId,
    centro_id: invitation.centro_id,
    rol: invitation.rol_objetivo,
  })
  if (roleErr) {
    logger.warn('accept: roles_usuario insert falló (rollback de la cuenta)', roleErr.message)
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
      tipoVinculoInvitacion: narrowTipoVinculoInvitacion(invitation.tipo_vinculo),
      parentesco: parsed.data.parentesco,
      descripcionParentesco: parsed.data.descripcionParentesco ?? null,
    })
    if (vinculoError) {
      logger.warn('accept: auto-vínculo tutor↔niño falló (rollback de la cuenta)', vinculoError)
      await service.from('roles_usuario').delete().eq('usuario_id', userId)
      await service.auth.admin.deleteUser(userId).catch(() => {})
      return fail(vinculoError)
    }
  }

  // Auto-vínculo profe → profes_aulas (rama F11-C-2; solo rol 'profe' con aula).
  if (invitation.rol_objetivo === 'profe' && invitation.aula_id) {
    const { error: profeError } = await crearVinculoProfeAula(service, {
      profeId: userId,
      aulaId: invitation.aula_id,
      tipoPersonalAula: invitation.tipo_personal_aula,
    })
    if (profeError) {
      // 23505 coordinadora (decisión E): conflicto recuperable — la cuenta queda
      // creada y el vínculo se completa desde gestión o vía B8 cuando se libere el
      // slot (no se marca `accepted_at`). Cualquier otro error es un fallo real de
      // inserción → rollback de la cuenta recién creada.
      logger.warn('accept: vínculo profe↔aula falló', profeError)
      if (profeError !== 'auth.invitation.errors.coordinadora_ocupada') {
        await service.from('roles_usuario').delete().eq('usuario_id', userId)
        await service.auth.admin.deleteUser(userId).catch(() => {})
      }
      return fail(profeError)
    }
  }

  const { error: acceptedErr } = await service
    .from('invitaciones')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)
  if (acceptedErr) {
    // La cuenta ya está creada y usable; solo el sello de aceptación falló (la invitación
    // quedaría reutilizable). No se revierte, pero NO se traga en silencio.
    logger.warn('accept: marcar invitación accepted_at falló', acceptedErr.message)
  }

  // Login automático en el contexto del request actual.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  })
  if (signInErr) {
    logger.warn('signIn tras accept-invitation falló', signInErr.message)
  }

  return ok({ rol: invitation.rol_objetivo, usuarioId: userId })
}

/**
 * Wrapper B2 sin avatar (comportamiento histórico, un solo round-trip): crea la cuenta
 * y, en éxito, redirige server-side al panel (la cookie viaja al destino vía
 * updateSession). El camino con avatar usa `acceptInvitationCore` + `redirigirAlPanel`.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  locale: string = 'es'
): Promise<ActionResult<never>> {
  const r = await acceptInvitationCore(input)
  if (!r.success) return r
  redirect(dashboardPorRol(locale, r.data.rol))
}

/**
 * Redirige al panel tras un alta con `acceptInvitationCore` (avatar opcional ya
 * subido). Es un `redirect` server-side aislado para conservar el mismo no-flash /
 * propagación de cookie que el wrapper, sin re-ejecutar la mutación de alta.
 */
export async function redirigirAlPanel(locale: string, rol: string): Promise<never> {
  redirect(dashboardPorRol(locale, rol))
}

/** Panel inicial según el rol objetivo de la invitación. */
function dashboardPorRol(locale: string, rolObjetivo: string): string {
  if (rolObjetivo === 'admin') return `/${locale}/admin`
  if (rolObjetivo === 'profe') return `/${locale}/teacher`
  return `/${locale}/family`
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
  return acceptPendingInvitationCore(
    { serviceClient: service, user: { id: user.user.id, email: user.user.email } },
    invitationId,
    vinculo
  )
}

interface AcceptPendingDeps {
  serviceClient: ServiceClient
  user: { id: string; email: string }
}

/**
 * Núcleo testeable de B8 (cliente service-role + usuario de sesión inyectables).
 * Inserta el rol objetivo (idempotente) y, según el rol, el auto-vínculo: familiar
 * (`vinculos_familiares`) o, en B8-profe (decisión F, F11-C-2), `profes_aulas`. Un
 * profe que ya tiene cuenta (p. ej. también es tutor) queda vinculado a su aula sin
 * crear otra cuenta. El 23505 de coordinadora se devuelve como mensaje amable.
 */
export async function acceptPendingInvitationCore(
  deps: AcceptPendingDeps,
  invitationId: string,
  vinculo?: { parentesco?: string; descripcionParentesco?: string | null }
): Promise<ActionResult<{ rol: string }>> {
  const { serviceClient: service, user } = deps
  const { data: invitation, error: invErr } = await service
    .from('invitaciones')
    .select(
      'id, email, rol_objetivo, centro_id, nino_id, aula_id, tipo_personal_aula, tipo_vinculo, expires_at, accepted_at, rejected_at'
    )
    .eq('id', invitationId)
    .maybeSingle()

  if (invErr) logger.warn('acceptPending: lookup de invitación falló', invErr.message)
  if (!invitation) return fail('auth.invitation.errors.invalid')
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
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
    usuario_id: user.id,
    centro_id: invitation.centro_id,
    rol: invitation.rol_objetivo,
  })
  if (roleErr) {
    // Ignoramos error si el rol ya existía (UNIQUE constraint).
    if (!roleErr.message.includes('duplicate')) {
      logger.warn('acceptPending: roles_usuario insert falló', roleErr.message)
      return fail('auth.invitation.errors.role_failed')
    }
  }

  // Auto-vínculo idempotente (mismo que el flujo de nuevo usuario).
  if (creaVinculo && invitation.nino_id && vinculo?.parentesco) {
    const { error: vinculoError } = await crearVinculoAutomatico(service, {
      ninoId: invitation.nino_id,
      usuarioId: user.id,
      rolObjetivo: invitation.rol_objetivo,
      tipoVinculoInvitacion: narrowTipoVinculoInvitacion(invitation.tipo_vinculo),
      parentesco: vinculo.parentesco,
      descripcionParentesco: vinculo.descripcionParentesco ?? null,
    })
    if (vinculoError) {
      logger.warn('acceptPending: auto-vínculo tutor↔niño falló', vinculoError)
      return fail(vinculoError)
    }
  }

  // B8-profe (decisión F): inserta `profes_aulas`. El rol 'profe' ya se insertó
  // arriba (idempotente); si el vínculo de aula falla con 23505 no marcamos
  // `accepted_at` → un reintento (cuando se libere el slot de coordinadora)
  // re-inserta el rol (duplicate ignorado) y completa el vínculo.
  if (invitation.rol_objetivo === 'profe' && invitation.aula_id) {
    const { error: profeError } = await crearVinculoProfeAula(service, {
      profeId: user.id,
      aulaId: invitation.aula_id,
      tipoPersonalAula: invitation.tipo_personal_aula,
    })
    if (profeError) {
      logger.warn('acceptPending: vínculo profe↔aula falló', profeError)
      return fail(profeError)
    }
  }

  const { error: acceptedErr } = await service
    .from('invitaciones')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)
  if (acceptedErr) {
    logger.warn('acceptPending: marcar invitación accepted_at falló', acceptedErr.message)
  }

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
