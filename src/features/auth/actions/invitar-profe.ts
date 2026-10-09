'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

import {
  invitarProfeSchema,
  type InvitarProfeInput,
  type SendInvitationInput,
} from '../schemas/invitation'

import { sendInvitation } from './send-invitation'
import { fail, ok, type ActionResult } from './types'

/**
 * Onboarding de profesor (F11-C-1) — la dirección invita a un profe nuevo
 * fijando nombre + email + un aula + su tipo de personal. Reusa el NÚCLEO de
 * `sendInvitation` (gate `es_admin`, dedup por email+centro+rol, email GoTrue) y
 * persiste los campos propios de la invitación de profe (`nombre_completo` y
 * `tipo_personal_aula`, que `sendInvitation` no maneja).
 *
 * Decisión E (spec onboarding-profe): la coordinadora-única se valida AL INVITAR
 * — si el aula ya tiene coordinadora activa en `profes_aulas`, NO se crea la
 * invitación (evita cuentas a medias). La red del `23505` en el accept llega en
 * F11-C-2. El caso de DOS invitaciones pendientes como coordinadora a la misma
 * aula (ninguna ha creado aún la fila de `profes_aulas`) lo cubre ese 23505.
 */
export async function invitarProfe(
  input: InvitarProfeInput,
  locale: string = 'es'
): Promise<ActionResult<{ invitationId: string }>> {
  const admin = await centrosAdminDelLlamador()
  if (!admin.success) return fail(admin.error)

  const service = createServiceRoleClient()
  const r = await invitarProfeCore(
    { serviceClient: service, sendInvitationFn: sendInvitation, centrosAdmin: admin.data },
    input,
    locale
  )
  if (r.success) revalidatePath('/[locale]/admin/personal', 'page')
  return r
}

/**
 * R5 — sesión + centros donde quien llama es admin, ANTES de cualquier lectura con service
 * client. Sin sesión o sin ningún rol admin se rechaza sin haber leído nada; con ellos, toda
 * lectura service-role se acota a esos centros (`.in('centro_id', …)`), así que un uuid ajeno
 * y uno inexistente dan la misma respuesta (sin oráculo "existe / tiene coordinadora").
 * Lee los roles con el cliente del usuario (RLS: los suyos).
 */
async function centrosAdminDelLlamador(): Promise<ActionResult<string[]>> {
  const supabase = await createClient()
  const { data: userRes } = await supabase.auth.getUser()
  if (!userRes.user) return fail('auth.invitation.errors.unauthenticated')

  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userRes.user.id)
    .eq('rol', 'admin')
    .is('deleted_at', null)
  const centros = (roles ?? []).map((r) => r.centro_id)
  if (centros.length === 0) return fail('auth.invitation.errors.forbidden')
  return ok(centros)
}

interface InvitarProfeDeps {
  serviceClient: SupabaseClient<Database>
  /** Centros donde quien llama es admin (`centrosAdminDelLlamador`, R5). */
  centrosAdmin: string[]
  sendInvitationFn: (
    input: SendInvitationInput,
    locale: string
  ) => Promise<ActionResult<{ invitationId: string }>>
}

/** Núcleo testeable (clientes/colaboradores inyectables; sin `revalidatePath`). */
export async function invitarProfeCore(
  deps: InvitarProfeDeps,
  input: InvitarProfeInput,
  locale: string
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = invitarProfeSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'auth.validation.invalid')
  }
  const { serviceClient, sendInvitationFn, centrosAdmin } = deps
  if (centrosAdmin.length === 0) return fail('auth.invitation.errors.forbidden')

  // 1. Derivar el centro del aula (y verificar que existe). No se pide centro en
  //    el input: se deriva del aula para no fiarse del cliente. Acotado a los centros
  //    donde quien llama es admin (R5): un aula ajena = inexistente.
  const { data: aula } = await serviceClient
    .from('aulas')
    .select('centro_id')
    .eq('id', parsed.data.aulaId)
    .in('centro_id', centrosAdmin)
    .is('deleted_at', null)
    .maybeSingle()
  if (!aula) return fail('aula.errors.no_encontrada')

  // 2. Coordinadora-única AL INVITAR (decisión E): si el aula ya tiene
  //    coordinadora activa, no creamos la invitación.
  if (parsed.data.tipoPersonalAula === 'coordinadora') {
    const { data: coord } = await serviceClient
      .from('profes_aulas')
      .select('id')
      .eq('aula_id', parsed.data.aulaId)
      .eq('tipo_personal_aula', 'coordinadora')
      .is('fecha_fin', null)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (coord) return fail('auth.invitation.errors.coordinadora_ocupada')
  }

  // 3. Crear/refrescar la invitación reusando sendInvitation (gate es_admin del
  //    centro + dedup por email+centro+rol='profe'+nino_id(null) + email GoTrue).
  const sent = await sendInvitationFn(
    {
      email: parsed.data.email,
      rolObjetivo: 'profe',
      centroId: aula.centro_id,
      aulaId: parsed.data.aulaId,
      // Idioma del correo elegido por la Dirección; por defecto, castellano.
      idioma: parsed.data.idioma ?? 'es',
    },
    locale
  )
  if (!sent.success) return sent

  // 4. Persistir los campos propios de la invitación de profe.
  const { error } = await serviceClient
    .from('invitaciones')
    .update({
      nombre_completo: parsed.data.nombreCompleto,
      tipo_personal_aula: parsed.data.tipoPersonalAula,
    })
    .eq('id', sent.data.invitationId)
  if (error) return fail('auth.invitation.errors.update_failed')

  return ok({ invitationId: sent.data.invitationId })
}

/**
 * Reenvía una invitación de profe pendiente (refresca expiración + reenvía el
 * email). Reusa `sendInvitation`: su dedup encuentra ESTA misma invitación
 * (mismo email+centro+rol, `nino_id` NULL) y la actualiza. `nombre_completo` y
 * `tipo_personal_aula` se preservan (sendInvitation no los toca).
 */
export async function reenviarInvitacionProfe(
  invitationId: string,
  locale: string = 'es'
): Promise<ActionResult<void>> {
  const admin = await centrosAdminDelLlamador()
  if (!admin.success) return fail(admin.error)

  const service = createServiceRoleClient()
  return reenviarInvitacionProfeCore(
    { serviceClient: service, sendInvitationFn: sendInvitation, centrosAdmin: admin.data },
    invitationId,
    locale
  )
}

/** Núcleo testeable del reenvío (cliente/colaboradores/centros admin inyectables). */
export async function reenviarInvitacionProfeCore(
  deps: InvitarProfeDeps,
  invitationId: string,
  locale: string
): Promise<ActionResult<void>> {
  const { serviceClient, sendInvitationFn, centrosAdmin } = deps
  if (centrosAdmin.length === 0) return fail('auth.invitation.errors.forbidden')

  // Acotado a los centros donde quien llama es admin (R5): una invitación ajena = inexistente.
  const { data: inv } = await serviceClient
    .from('invitaciones')
    .select('email, centro_id, aula_id, rol_objetivo, accepted_at, rejected_at')
    .eq('id', invitationId)
    .in('centro_id', centrosAdmin)
    .maybeSingle()

  if (!inv || inv.rol_objetivo !== 'profe' || inv.accepted_at || inv.rejected_at) {
    return fail('auth.invitation.errors.invalid')
  }

  const r = await sendInvitationFn(
    {
      email: inv.email,
      rolObjetivo: 'profe',
      centroId: inv.centro_id,
      aulaId: inv.aula_id ?? undefined,
    },
    locale
  )
  if (!r.success) return r
  return ok(undefined)
}

/**
 * REVOCA (cancela) una invitación de profe pendiente. A diferencia de
 * `rejectPendingInvitation` (que valida que el email del invitado coincide con
 * el del usuario logueado — es para que el INVITADO rechace), aquí el ADMIN del
 * centro de la invitación la cancela. Marca `rejected_at` como sello de
 * cancelación (sin columna nueva en este alcance) → sale de "pendientes" y el
 * dedup de sendInvitation no la reutiliza (un re-invite crea fila nueva).
 */
export async function revocarInvitacionProfe(invitationId: string): Promise<ActionResult<void>> {
  const admin = await centrosAdminDelLlamador()
  if (!admin.success) return fail(admin.error)

  const service = createServiceRoleClient()
  const r = await revocarInvitacionProfeCore(service, invitationId, admin.data)
  if (r.success) revalidatePath('/[locale]/admin/personal', 'page')
  return r
}

/** Núcleo testeable de la revocación (cliente + centros admin de quien llama inyectables). */
export async function revocarInvitacionProfeCore(
  serviceClient: SupabaseClient<Database>,
  invitationId: string,
  centrosAdmin: string[]
): Promise<ActionResult<void>> {
  if (centrosAdmin.length === 0) return fail('auth.invitation.errors.forbidden')

  // Acotado a los centros donde quien llama es admin (R5): una invitación ajena = inexistente.
  const { data: inv } = await serviceClient
    .from('invitaciones')
    .select('id, centro_id, rol_objetivo, accepted_at, rejected_at')
    .eq('id', invitationId)
    .in('centro_id', centrosAdmin)
    .maybeSingle()

  if (!inv || inv.rol_objetivo !== 'profe' || inv.accepted_at || inv.rejected_at) {
    return fail('auth.invitation.errors.invalid')
  }
  if (!centrosAdmin.includes(inv.centro_id)) return fail('auth.invitation.errors.forbidden')

  await serviceClient
    .from('invitaciones')
    .update({ rejected_at: new Date().toISOString() })
    .eq('id', inv.id)

  return ok(undefined)
}
