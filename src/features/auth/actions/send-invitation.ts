'use server'

import { motivoQueImpideElRol } from '@/features/centros/contexto/escribir-roles'
import { esAdminEn, esResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'

import { enviarCorreoInvitacion } from '../lib/correo-invitacion'
import { llamarGoTrue } from '../lib/llamar-gotrue'
import { sendInvitationSchema, type SendInvitationInput } from '../schemas/invitation'

import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const INVITATION_TTL_DAYS = 7

/** Los roles que solo nombra la admin (como la anti-escalada de `invitaciones` en la BD). */
const ROLES_DE_LA_ADMIN: ReadonlyArray<string> = ['admin', 'directora']

/**
 * El segundo parámetro (locale de la UI de quien invita) ya no decide nada: el enlace del correo
 * lleva al idioma de la INVITACIÓN (`input.idioma`), el mismo en que sale el correo. Se mantiene
 * para no romper a quien lo pasa.
 */
export async function sendInvitation(
  input: SendInvitationInput,
  _locale: string = 'es'
): Promise<ActionResult<{ invitationId: string }>> {
  const parsed = sendInvitationSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'auth.validation.invalid'
    return fail(first)
  }

  // Validar usuario autenticado y que sea admin del centro objetivo.
  const supabase = await createClient()
  const { data: user, indisponible: authIndisponible } = await llamarGoTrue('getUser', () =>
    supabase.auth.getUser()
  )
  if (authIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (!user?.user) return fail('auth.invitation.errors.unauthenticated')

  if (!(await esAdminEn(supabase, user.user.id, parsed.data.centroId))) {
    return fail('auth.invitation.errors.forbidden')
  }
  // La invitación se escribe con service role, que se salta la anti-escalada de la RLS: invitar a
  // una admin o a una directora solo lo hace la admin del centro (o el superusuario).
  if (
    ROLES_DE_LA_ADMIN.includes(parsed.data.rolObjetivo) &&
    !(await esResponsableEn(supabase, user.user.id, parsed.data.centroId))
  ) {
    return fail('auth.invitation.errors.forbidden')
  }

  const service = createServiceRoleClient()

  // R2 (multi-centro): el niño y el aula de la invitación tienen que ser del centro objetivo.
  // Un admin del centro A no ata una invitación a un niño o un aula del centro B (al aceptar,
  // crearía el vínculo / la asignación en el otro centro).
  if (parsed.data.ninoId) {
    const { data: nino } = await service
      .from('ninos')
      .select('id')
      .eq('id', parsed.data.ninoId)
      .eq('centro_id', parsed.data.centroId)
      .maybeSingle()
    if (!nino) return fail('auth.invitation.errors.forbidden')
  }
  if (parsed.data.aulaId) {
    const { data: aula } = await service
      .from('aulas')
      .select('id')
      .eq('id', parsed.data.aulaId)
      .eq('centro_id', parsed.data.centroId)
      .maybeSingle()
    if (!aula) return fail('auth.invitation.errors.forbidden')
  }

  // Una profe de baja temporal no se vuelve a invitar: Dirección la reactiva desde Personal. Es
  // un aviso para quien invita; la puerta es la aceptación, que lo vuelve a mirar (si esta
  // lectura falla, se sigue).
  if (parsed.data.rolObjetivo === 'profe') {
    const { data: cuentas } = await service.rpc('buscar_auth_user_por_email', {
      p_email: parsed.data.email,
    })
    const cuenta = cuentas?.[0]
    if (cuenta) {
      const { motivo } = await motivoQueImpideElRol(service, {
        usuario_id: cuenta.id,
        centro_id: parsed.data.centroId,
        rol: 'profe',
      })
      if (motivo === 'baja_temporal') return fail('auth.invitation.errors.de_baja_temporal')
    }
  }

  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Tipo de vínculo a crear al aceptar (auto-vínculo). Coherente con el CHECK de BD:
  // tutor_legal → principal (default) o secundario; autorizado → 'autorizado';
  // directora/profe → NULL (no llevan vínculo familiar).
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

  const errorCorreo = await enviarCorreoInvitacion(service, {
    invitationId,
    email: parsed.data.email,
    rolObjetivo: parsed.data.rolObjetivo,
    centroId: parsed.data.centroId,
    idioma: parsed.data.idioma,
  })
  if (errorCorreo) return fail(errorCorreo)
  return ok({ invitationId })
}
