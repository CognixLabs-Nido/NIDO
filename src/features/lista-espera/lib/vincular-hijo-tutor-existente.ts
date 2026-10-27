import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getTranslations } from 'next-intl/server'

import { motivoQueNoVuelve } from '@/features/centros/contexto/escribir-roles'
import { resolverParentesco, type Parentesco } from '@/features/familias/lib/resolver-parentesco'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { logger } from '@/shared/lib/logger'
import type { Database, Json } from '@/types/database'

import { fail, ok, type ActionResult } from '../../centros/types'

import { buscarVinculoPrevio } from './vinculo-previo-tutor'

type ServiceClient = SupabaseClient<Database>

/** Retorno JSON de la RPC `crear_o_anadir_a_familia`. */
type ResultadoCrearFamilia = {
  resultado: 'familia_creada' | 'nino_anadido' | 'colision'
  familia_id: string | null
  nino_id: string | null
  matricula_id?: string | null
  colision_info: { motivo: string; nombre_existente: string | null } | null
}

export interface VincularHijoTutorExistenteParams {
  /** Cuenta REAL ya detectada del tutor (buscar_auth_user_por_email + roles → 'real'). */
  tutorUsuarioId: string
  centroId: string
  aulaId: string
  nombreNino: string
  apellidosNino: string
  fechaNacimiento: string
  /** Parentesco tecleado en el formulario (Completar siempre; Invitar solo si no hay herencia) — fallback si no hay herencia. */
  parentescoForm?: Parentesco
  descripcionParentescoForm?: string | null
  locale: string
}

/**
 * FIX A — camino feliz "el tutor YA existe": vincula un hijo NUEVO (promocionado desde un
 * prospecto) a la cuenta EXISTENTE del tutor, en vez de rechazar. NO recrea la cuenta, NO pide
 * contraseña, NO manda email/invitación (ya tiene acceso). Reutiliza el mismo motor que
 * la RPC transaccional `crear_o_anadir_a_familia` con el `usuario_id` real.
 *
 * Solo para un tutor que YA tiene familia en este centro (PR 1 de la Fase 4): la RPC busca su
 * familia SOLO en `p_centro_id` y rechaza (42501) una cuenta sin perfil aquí. Una cuenta de otro
 * centro no llega aquí: se le invita (`tutorDeEsteCentro`). Si llegara, se para antes de leer
 * nada de ella.
 *
 * Nombre EXACTO (anti-colisión, decisión 3 de Jose): se pasa su `familia_tutores.nombre_completo`
 * guardado → el chequeo de colisión por nombre de la RPC es inerte por construcción. El nombre
 * tecleado en el formulario del prospecto NO gana: es el mismo tutor real.
 */
export async function vincularHijoATutorExistente(
  service: ServiceClient,
  supabaseAutenticado: ServiceClient,
  params: VincularHijoTutorExistenteParams
): Promise<ActionResult<{ ninoId: string }>> {
  // 1. Perfil del tutor en ESTE centro → nombre EXACTO + email guardados.
  //    `familias!inner(centro_id)` acota por centro; no leemos el embed (solo filtra).
  const { data: perfil } = await service
    .from('familia_tutores')
    .select('nombre_completo, email, familias!inner(centro_id)')
    .eq('usuario_id', params.tutorUsuarioId)
    .eq('familias.centro_id', params.centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!perfil) return fail('admin.admisiones.anadirHijo.errors.no_autorizado')

  let nombreExacto = perfil.nombre_completo
  const emailTutor = perfil.email
  if (nombreExacto === null) {
    // Perfil de este centro sin nombre guardado: el de su cuenta (es la misma persona, ya de aquí).
    const { data: usuario } = await service
      .from('usuarios')
      .select('nombre_completo')
      .eq('id', params.tutorUsuarioId)
      .maybeSingle()
    nombreExacto = usuario?.nombre_completo ?? ''
  }

  // 2. Parentesco del hijo NUEVO: hereda del vínculo previo del tutor (consistente entre
  //    hermanos); si no hay herencia, usa el del formulario; si tampoco, falla (sin default
  //    silencioso). La lectura vive en `buscarVinculoPrevio` (sin filtrar `deleted_at`, solo
  //    los vínculos con niños de este centro), compartida con la lista de Admisiones para que su aviso
  //    `necesita_parentesco` diga lo mismo que esta herencia.
  const vinculoPrevio = await buscarVinculoPrevio(service, params.tutorUsuarioId, params.centroId)
  const resolucion = resolverParentesco(
    vinculoPrevio,
    params.parentescoForm,
    params.descripcionParentescoForm
  )
  if (!resolucion.ok) return fail('admin.admisiones.anadirHijo.errors.parentesco_requerido')

  // 3. RPC transaccional por el cliente AUTENTICADO (gate `es_admin(auth.uid(), centro)`).
  const { data: rpcData, error: rpcError } = await supabaseAutenticado.rpc(
    'crear_o_anadir_a_familia',
    {
      p_nombre_nino: params.nombreNino,
      p_apellidos_nino: params.apellidosNino,
      p_fecha_nacimiento: params.fechaNacimiento,
      p_centro_id: params.centroId,
      p_aula_id: params.aulaId,
      // Email INERTE con `usuario_id` seteado (detección por usuario_id); por limpieza se pasa el guardado.
      p_tutor_email: emailTutor ?? '',
      // EXACTO el guardado → neutraliza el chequeo de colisión por nombre de la RPC.
      p_tutor_nombre_completo: nombreExacto,
      p_parentesco: resolucion.parentesco,
      p_descripcion_parentesco: resolucion.descripcionParentesco,
      p_usuario_id: params.tutorUsuarioId,
      p_permisos: permisosDefault('tutor_legal_principal') as Json,
    }
  )
  if (rpcError) {
    logger.warn('vincularHijoATutorExistente rpc', rpcError.message)
    if (rpcError.code === '42501') return fail('admin.admisiones.anadirHijo.errors.no_autorizado')
    // La tabla de motivos de la BD no devuelve el rol a quien tiene en curso el olvido.
    if (motivoQueNoVuelve(rpcError) === 'solicitud_olvido')
      return fail('listaEspera.errors.tutor_olvido')
    return fail('listaEspera.errors.alta_fallo')
  }
  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    // No esperado (pasamos el nombre exacto) → inconsistencia de datos; se propaga, no se traga.
    logger.warn(
      'vincularHijoATutorExistente colision inesperada',
      res.colision_info?.nombre_existente ?? ''
    )
    return fail('admin.admisiones.anadirHijo.errors.colision')
  }
  const ninoId = res.nino_id as string

  // 4. Push transitorio best-effort al tutor. Si falla, el alta YA está hecha → no revierte.
  //    U-3/D3: apunta DIRECTO al wizard del hijo nuevo (`/alta/{ninoId}`), que es lo único que
  //    el tutor tiene que hacer. Antes iba a la ficha (`/family/nino/{ninoId}`) y solo llegaba
  //    al wizard de rebote, por la redirección de "alta pendiente" — un salto de más.
  try {
    const { data: perfilUsuario } = await service
      .from('usuarios')
      .select('idioma_preferido')
      .eq('id', params.tutorUsuarioId)
      .maybeSingle()
    const idioma = perfilUsuario?.idioma_preferido ?? params.locale
    const tPush = await getTranslations({
      locale: idioma,
      namespace: 'admin.admisiones.anadirHijo',
    })
    await enviarPushANotificarUsuarios([params.tutorUsuarioId], {
      titulo: tPush('push_titulo'),
      // Sin el nombre del niño (F11-B, punto 8): la notificación se ve en la pantalla bloqueada.
      cuerpo: `${tPush('push_cuerpo')} ${params.nombreNino}`,
      url: `/${idioma}/alta/${ninoId}`,
      datos: { tipo: 'alta_hijo', nino_id: ninoId },
    })
  } catch (err) {
    logger.warn(
      'vincularHijoATutorExistente push',
      err instanceof Error ? err.message : String(err)
    )
  }

  return ok({ ninoId })
}
