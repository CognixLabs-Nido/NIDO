import type { SupabaseClient } from '@supabase/supabase-js'

import { clasificarCuenta } from '@/features/auth/lib/clasificar-cuenta'
import { logger } from '@/shared/lib/logger'
import { CONSENT_OBLIGATORIOS, CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import type { Database } from '@/types/database'

import { fail, ok, type ActionResult } from '../actions/types'
import { llamarGoTrue } from './llamar-gotrue'

type ServiceClient = SupabaseClient<Database>

export interface CrearTutorDirectoParams {
  /** Cuenta del tutor: la Dirección teclea email + contraseña provisional. */
  email: string
  password: string
  /** Nombre completo REAL del tutor (nombre + apellidos tecleados por la Dirección). */
  nombreCompleto: string
  /** Idioma de la cuenta (metadata → `usuarios.idioma_preferido` vía handle_new_user). */
  idiomaPreferido: 'es' | 'en' | 'va'
}

/**
 * Modo "Completa Dirección" (F-2b-2a) — **solo la cuenta GoTrue + consentimientos**.
 *
 * FRONTERA LIMPIA: desde F-2b-2a el niño, la matrícula, la familia, el perfil del tutor
 * (`familia_tutores`), el rol y el vínculo los crea la RPC transaccional
 * `crear_o_anadir_a_familia` (atómica). Aquí NO queda NINGUNA escritura de esas entidades:
 * lo único fuera de la RPC es la cuenta de Supabase Auth (no es SQL → no puede ir dentro
 * de la transacción) y sus acuses de consentimiento presencial (best-effort, por usuario).
 *
 * Idempotencia del reintento: `clasificarCuenta` distingue `nueva`/`stub`/`real`. Si la RPC
 * falló tras crear la cuenta, el reintento la ve como `stub` (cuenta sin roles) y la
 * REUTILIZA (no re-crea, no falla por "email exists"); una cuenta `real` (ya operativa) se
 * rechaza (la resolución cuenta-existente llega en una fase posterior). GoTrue va envuelto en
 * `llamarGoTrue` (PR-A): un fallo de infraestructura devuelve `servicio_no_disponible` sin
 * dejar estado a medias.
 *
 * Consentimientos (términos/privacidad) — la familia firmó en PAPEL: se registran a nombre
 * del tutor con `metodo_firma='presencial'` (best-effort; si falla se loguea y NO se aborta:
 * el tutor podrá re-consentir al entrar). NO crea niño/matrícula/rol/vínculo: eso es la RPC.
 */
export async function crearTutorDirecto(
  service: ServiceClient,
  params: CrearTutorDirectoParams
): Promise<ActionResult<{ usuarioId: string }>> {
  // 1. Clasificar la cuenta del email (idempotencia del reintento). `listUsers` localiza la
  //    fila auth; la señal de "cuenta real" es tener al menos un rol (igual que accept-invitation).
  const { data: existentes, indisponible: listIndisponible } = await llamarGoTrue('listUsers', () =>
    service.auth.admin.listUsers()
  )
  if (listIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')

  const authUser = (existentes?.users ?? []).find(
    (u) => u.email?.toLowerCase() === params.email.toLowerCase()
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
  // Cuenta operativa (con roles): la resolución cuenta-existente es una fase posterior.
  if (clase === 'real') return fail('auth.invitation.errors.email_already_registered')

  let usuarioId: string
  if (clase === 'stub' && authUser) {
    // Reintento: completa el stub (fija password real, confirma email y metadata) SIN re-crear.
    const {
      data: updated,
      error: updateErr,
      indisponible: updIndisponible,
    } = await llamarGoTrue('updateUserById', () =>
      service.auth.admin.updateUserById(authUser.id, {
        password: params.password,
        email_confirm: true,
        user_metadata: {
          nombre_completo: params.nombreCompleto,
          idioma_preferido: params.idiomaPreferido,
        },
      })
    )
    if (updIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
    if (updateErr || !updated?.user) {
      logger.warn('crearTutorDirecto updateUserById', updateErr?.message)
      return fail('auth.invitation.errors.create_failed')
    }
    usuarioId = updated.user.id
  } else {
    // Cuenta nueva con credenciales de la Dirección. `email_confirm:true` la deja usable ya;
    // `handle_new_user` puebla `public.usuarios` con el nombre REAL de la metadata.
    const {
      data: created,
      error: createErr,
      indisponible: creaIndisponible,
    } = await llamarGoTrue('createUser', () =>
      service.auth.admin.createUser({
        email: params.email,
        password: params.password,
        email_confirm: true,
        user_metadata: {
          nombre_completo: params.nombreCompleto,
          idioma_preferido: params.idiomaPreferido,
        },
      })
    )
    if (creaIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
    if (createErr || !created?.user) {
      logger.warn('crearTutorDirecto createUser', createErr?.message)
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
    usuarioId = created.user.id
  }

  // 2. Acuses obligatorios (términos + privacidad) A NOMBRE DEL TUTOR, marcados PRESENCIAL.
  //    Best-effort: si alguno falla, se loguea pero NO se revierte (el tutor re-consiente al entrar).
  for (const tipo of CONSENT_OBLIGATORIOS) {
    const { error: consentErr } = await service.rpc('registrar_consentimiento', {
      p_usuario_id: usuarioId,
      p_tipo: tipo,
      p_version: CONSENT_VERSIONS[tipo],
      p_metodo: 'presencial',
    })
    if (consentErr) {
      logger.warn('crearTutorDirecto consentimiento presencial', consentErr.message)
    }
  }

  return ok({ usuarioId })
}
