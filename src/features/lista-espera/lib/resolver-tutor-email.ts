import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { detectarTutor, guardaTutorUsuarioId, type DeteccionTutor } from './deteccion-tutor'

type ServiceClient = SupabaseClient<Database>

export interface TutorResuelto {
  deteccion: DeteccionTutor
  /** `usuario_id` a persistir en `lista_espera.tutor_usuario_id`, o null si es familia nueva. */
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
 * U-5 (D7) — resuelve por EMAIL si el prospecto es de familia nueva o el 2.º hijo de una familia
 * de ESTE centro. Es la ÚNICA fuente de verdad: la usan la vista previa del diálogo (solo
 * lectura), `crearProspecto` y `editarProspecto` al persistir, y la promoción (`invitarAlAlta`,
 * `completarEnDireccion`), de modo que lo que se anuncia, lo que se guarda y lo que se hace no
 * pueden divergir. El cliente nunca decide esto: manda el email, el servidor resuelve.
 *
 * PR 1 (Fase 4): solo mira este centro. Una cuenta con roles o familia en otro centro se resuelve
 * como `familia_nueva`, igual que un email sin cuenta: la directora no sabe si existe (D4) y, al
 * promover, se le invita y acepta. Nunca se guarda su `usuario_id`.
 *
 * Va por SERVICE ROLE porque `buscar_auth_user_por_email` vive fuera del alcance del admin por
 * RLS. Quien la invoca YA ha comprobado que es admin del centro.
 *
 * Ante fallo del servicio de cuentas, o de la lectura del perfil, devuelve `null` (no
 * `familia_nueva`): quien llama decide si abortar en vez de clasificar a ciegas.
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

  // ¿Tiene perfil en una familia de ESTE centro? Es lo único que cuenta.
  const { data: perfil, error: perfilErr } = await service
    .from('familia_tutores')
    .select('familias!inner(id, etiqueta, centro_id)')
    .eq('usuario_id', authUser.id)
    .eq('familias.centro_id', centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (perfilErr) {
    logger.warn('resolverTutorPorEmail familia_tutores', perfilErr.message)
    return null
  }

  const deteccion = detectarTutor({ hayEmail: true, familiaEnEsteCentro: perfil !== null })
  return {
    deteccion,
    tutorUsuarioId: guardaTutorUsuarioId(deteccion) ? authUser.id : null,
    familiaEtiqueta: perfil?.familias?.etiqueta ?? null,
  }
}

/**
 * ¿La cuenta tiene perfil en una familia de este centro? Lo que la RPC de alta y el trigger de
 * `lista_espera` exigen para vincular sin invitar. `null` si la lectura falla.
 *
 * La promoción lo vuelve a preguntar aunque el prospecto ya traiga `tutor_usuario_id`: la familia
 * pudo darse de baja desde que se guardó.
 */
export async function tienePerfilEnCentro(
  service: ServiceClient,
  usuarioId: string,
  centroId: string
): Promise<boolean | null> {
  const { data, error } = await service
    .from('familia_tutores')
    .select('id, familias!inner(centro_id)')
    .eq('usuario_id', usuarioId)
    .eq('familias.centro_id', centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) {
    logger.warn('tienePerfilEnCentro', error.message)
    return null
  }
  return data !== null
}

/**
 * Al PROMOVER un prospecto (`invitarAlAlta`, `completarEnDireccion`): ¿a qué cuenta se vincula el
 * niño sin invitar? Solo a la de un tutor que ya tiene familia en este centro (el 2.º hijo). Primero
 * la que guardó el prospecto (`tutor_usuario_id`, D1), si sigue teniendo familia aquí; si no, la
 * del email. Cualquier otra —de otro centro, del personal, el superusuario— devuelve `null`: se
 * invita y acepta desde su perfil.
 *
 * `undefined` si no se pudo saber: quien llama no sigue.
 */
export async function tutorDeEsteCentro(
  service: ServiceClient,
  params: { tutorPrevioId: string | null; email: string | null; centroId: string }
): Promise<string | null | undefined> {
  if (params.tutorPrevioId) {
    const aqui = await tienePerfilEnCentro(service, params.tutorPrevioId, params.centroId)
    if (aqui === null) return undefined
    if (aqui) return params.tutorPrevioId
  }
  const resuelto = await resolverTutorPorEmail(service, params.email, params.centroId)
  if (!resuelto) return undefined
  return resuelto.tutorUsuarioId
}
