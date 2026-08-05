import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getTranslations } from 'next-intl/server'

import { resolverParentesco, type Parentesco } from '@/features/familias/lib/resolver-parentesco'
import { enviarPushANotificarUsuarios } from '@/features/push/lib/enviar-push'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { logger } from '@/shared/lib/logger'
import type { Database, Json } from '@/types/database'

import { fail, ok, type ActionResult } from '../../centros/types'

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
  /** Parentesco tecleado en el formulario (Completar lo trae; Invitar no) — fallback si no hay herencia. */
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
 * Resolución de familia por CENTRO (multi-centro seguro): la RPC busca la familia del tutor
 * SOLO en `p_centro_id` (`familia_tutores.usuario_id` JOIN `familias.centro_id = p_centro_id`).
 * Si el tutor existe pero NO tiene familia en este centro (p. ej. es tutor en OTRO centro), la
 * RPC crea una familia NUEVA en este centro ligada a su `usuario_id` → 'familia_creada'. Nunca
 * se cruzan centros.
 *
 * Nombre EXACTO (anti-colisión, decisión 3 de Jose): si el tutor ya tiene perfil en este centro
 * se pasa su `familia_tutores.nombre_completo` guardado → el chequeo de colisión por nombre de
 * la RPC es inerte por construcción. El nombre tecleado en el formulario del prospecto NO gana:
 * es el mismo tutor real. Si no tiene perfil aquí, se usa `usuarios.nombre_completo` (la RPC no
 * comprueba colisión al crear familia nueva).
 */
export async function vincularHijoATutorExistente(
  service: ServiceClient,
  supabaseAutenticado: ServiceClient,
  params: VincularHijoTutorExistenteParams
): Promise<ActionResult<{ ninoId: string }>> {
  // 1. Perfil del tutor en ESTE centro (si lo tiene) → nombre EXACTO + email guardados.
  //    `familias!inner(centro_id)` acota por centro; no leemos el embed (solo filtra).
  const { data: perfil } = await service
    .from('familia_tutores')
    .select('nombre_completo, email, familias!inner(centro_id)')
    .eq('usuario_id', params.tutorUsuarioId)
    .eq('familias.centro_id', params.centroId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  let nombreExacto = perfil?.nombre_completo ?? null
  const emailTutor = perfil?.email ?? null
  if (nombreExacto === null) {
    // Sin familia en este centro (multi-centro / cuenta sin familia aquí): la RPC creará una
    // familia nueva → usamos el nombre del perfil de usuario (no hay colisión posible).
    const { data: usuario } = await service
      .from('usuarios')
      .select('nombre_completo')
      .eq('id', params.tutorUsuarioId)
      .maybeSingle()
    nombreExacto = usuario?.nombre_completo ?? ''
  }

  // 2. Parentesco del hijo NUEVO: hereda del vínculo previo del tutor (consistente entre
  //    hermanos); si no hay herencia, usa el del formulario; si tampoco, falla (sin default
  //    silencioso). La query NO filtra `deleted_at`
  //    a propósito (un vínculo archivado sigue diciendo la verdad del parentesco).
  const { data: vinculoPrevio } = await service
    .from('vinculos_familiares')
    .select('parentesco, descripcion_parentesco')
    .eq('usuario_id', params.tutorUsuarioId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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
      cuerpo: tPush('push_cuerpo', { nombre: params.nombreNino }),
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
