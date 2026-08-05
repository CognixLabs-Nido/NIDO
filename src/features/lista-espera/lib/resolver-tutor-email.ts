import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { detectarTutor, guardaTutorUsuarioId, type DeteccionTutor } from './deteccion-tutor'

type ServiceClient = SupabaseClient<Database>

export interface TutorResuelto {
  deteccion: DeteccionTutor
  /** `usuario_id` a persistir en `lista_espera.tutor_usuario_id`, o null si familia nueva. */
  tutorUsuarioId: string | null
  /** Etiqueta de la familia de ESTE centro, para que el diálogo diga a cuál se añade. */
  familiaEtiqueta: string | null
}

const FAMILIA_NUEVA: TutorResuelto = {
  deteccion: 'familia_nueva',
  tutorUsuarioId: null,
  familiaEtiqueta: null,
}

/**
 * U-5 (D7) — resuelve por EMAIL si el prospecto es de familia nueva o de un tutor que ya
 * existe. Es la ÚNICA fuente de verdad: la usa tanto la vista previa del diálogo (solo
 * lectura) como `crearProspecto` al persistir, de modo que lo que se anuncia y lo que se
 * guarda no pueden divergir. El cliente nunca decide esto: manda el email, el servidor
 * resuelve.
 *
 * Va por SERVICE ROLE porque `buscar_auth_user_por_email` y `roles_usuario` viven fuera del
 * alcance del admin por RLS. Quien la invoca YA ha comprobado que es admin del centro.
 *
 * Ante fallo del servicio de cuentas devuelve `null` (no `familia_nueva`): quien llama decide
 * si abortar —`crearProspecto` lo hace— en vez de crear a ciegas un prospecto mal clasificado.
 */
export async function resolverTutorPorEmail(
  service: ServiceClient,
  email: string | null,
  centroId: string
): Promise<TutorResuelto | null> {
  const limpio = email?.trim() ?? ''
  if (!limpio) return FAMILIA_NUEVA

  const { data: authUser, error } = await service
    .rpc('buscar_auth_user_por_email', { p_email: limpio })
    .maybeSingle()
  if (error) {
    logger.warn('resolverTutorPorEmail buscar_auth_user_por_email', error.message)
    return null
  }
  if (!authUser) return FAMILIA_NUEVA

  // Roles: la señal de cuenta OPERATIVA (una invitación a medias no cuenta). Global a
  // propósito, igual que en `invitarAlAlta`: la persona existe aunque su rol esté en otro
  // centro, y el enlace por `usuario_id` sigue siendo el correcto.
  const { data: roles } = await service
    .from('roles_usuario')
    .select('usuario_id')
    .eq('usuario_id', authUser.id)
    .is('deleted_at', null)
    .limit(1)

  // ¿Tiene familia en ESTE centro? Solo para etiquetar bien (y poder nombrarla en pantalla).
  const { data: perfil } = await service
    .from('familia_tutores')
    .select('familias!inner(id, etiqueta, centro_id)')
    .eq('usuario_id', authUser.id)
    .eq('familias.centro_id', centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  const deteccion = detectarTutor({
    hayEmail: true,
    cuentaExiste: true,
    tieneRoles: (roles?.length ?? 0) > 0,
    familiaEnEsteCentro: perfil !== null,
  })

  return {
    deteccion,
    tutorUsuarioId: guardaTutorUsuarioId(deteccion) ? authUser.id : null,
    familiaEtiqueta: perfil?.familias?.etiqueta ?? null,
  }
}
