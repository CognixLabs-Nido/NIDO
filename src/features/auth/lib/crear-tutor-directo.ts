import type { SupabaseClient } from '@supabase/supabase-js'

import { parentescoEnum, permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { fail, ok, type ActionResult } from '../actions/types'

type ServiceClient = SupabaseClient<Database>

export interface CrearTutorDirectoParams {
  /** Cuenta del tutor: la Dirección teclea email + contraseña provisional. */
  email: string
  password: string
  /** Nombre completo REAL del tutor (nombre + apellidos tecleados por la Dirección). */
  nombreCompleto: string
  /** Centro y niño contra los que se crean rol y vínculo (ya existentes al llamar). */
  centroId: string
  ninoId: string
  /** Parentesco declarado en el diálogo para el vínculo familiar. */
  parentesco: string
  descripcionParentesco: string | null
  /** Idioma de la cuenta (metadata → `usuarios.idioma_preferido` vía handle_new_user). */
  idiomaPreferido: 'es' | 'en' | 'va'
}

/**
 * Modo "Completa Dirección" (PR-3a): crea la cuenta del tutor SIN invitación por email.
 * A diferencia de `acceptInvitationCore`, la Dirección pone email+contraseña y NO se manda
 * correo (`createUser`, no `inviteUserByEmail`). El tutor activa luego con "he olvidado la
 * contraseña" (resetPasswordForEmail funciona: la cuenta nace con `email_confirm:true` y
 * contraseña real, indistinguible de una normal).
 *
 * Reutiliza el mismo andamiaje service-role de accept-invitation:
 *   - `createServiceRoleClient` (lo pasa el orquestador para compartir cliente y rollback),
 *   - `service.auth.admin.createUser` (idéntico al camino "cuenta nueva" de B2),
 *   - INSERT `roles_usuario` (rol tutor_legal en el centro del niño),
 *   - upsert `vinculos_familiares` con `permisosDefault` (mismo patrón que `crearVinculoAutomatico`).
 *
 * El nombre del tutor es el REAL que teclea la Dirección (nombre + apellidos): se pasa como
 * `user_metadata.nombre_completo`, así `handle_new_user` lo usa tal cual y NUNCA cae al
 * fallback del local-part del email (el email no guarda relación con el nombre).
 *
 * NO captura consentimientos (términos/privacidad): los presta el propio tutor, no la
 * Dirección → quedan para cuando el tutor entre (PR-3b / activación). Tampoco crea niño ni
 * matrícula: eso lo hace el orquestador ANTES (necesita el `ninoId` aquí).
 *
 * Rollback interno en cascada: si falla rol o vínculo, borra la cuenta recién creada para
 * no dejar un usuario huérfano. El niño/matrícula los revierte el orquestador si esto falla.
 */
export async function crearTutorDirecto(
  service: ServiceClient,
  params: CrearTutorDirectoParams
): Promise<ActionResult<{ usuarioId: string }>> {
  // Cuenta nueva con credenciales puestas por la Dirección. `email_confirm:true` la deja
  // usable de inmediato; el trigger `handle_new_user` puebla `public.usuarios` con el
  // `nombre_completo` REAL de la metadata (nombre + apellidos tecleados), sin fallback.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      nombre_completo: params.nombreCompleto,
      idioma_preferido: params.idiomaPreferido,
    },
  })
  if (createErr || !created.user) {
    logger.warn('crearTutorDirecto createUser', createErr?.message)
    // Email ya registrado → mensaje específico (Supabase responde 422/"already registered").
    const dup =
      createErr?.status === 422 ||
      (createErr?.message ?? '').toLowerCase().includes('already') ||
      (createErr?.message ?? '').toLowerCase().includes('registered')
    return fail(
      dup
        ? 'auth.invitation.errors.email_already_registered'
        : 'auth.invitation.errors.create_failed'
    )
  }
  const usuarioId = created.user.id

  const { error: roleErr } = await service.from('roles_usuario').insert({
    usuario_id: usuarioId,
    centro_id: params.centroId,
    rol: 'tutor_legal',
  })
  if (roleErr) {
    logger.warn('crearTutorDirecto rol', roleErr.message)
    await service.auth.admin.deleteUser(usuarioId).catch(() => {})
    return fail('auth.invitation.errors.role_failed')
  }

  // Vínculo tutor↔niño (tutor_legal_principal, permisos por defecto = todos true). Upsert
  // idempotente como en `crearVinculoAutomatico`: si ya existiera, no falla.
  const { error: vinculoErr } = await service.from('vinculos_familiares').upsert(
    {
      nino_id: params.ninoId,
      usuario_id: usuarioId,
      tipo_vinculo: 'tutor_legal_principal',
      parentesco: params.parentesco as ReturnType<typeof parentescoEnum.parse>,
      descripcion_parentesco: params.descripcionParentesco,
      permisos: permisosDefault('tutor_legal_principal'),
    },
    { onConflict: 'nino_id,usuario_id', ignoreDuplicates: true }
  )
  if (vinculoErr) {
    logger.warn('crearTutorDirecto vínculo', vinculoErr.message)
    await service.from('roles_usuario').delete().eq('usuario_id', usuarioId)
    await service.auth.admin.deleteUser(usuarioId).catch(() => {})
    return fail('vinculo.errors.create_failed')
  }

  return ok({ usuarioId })
}
