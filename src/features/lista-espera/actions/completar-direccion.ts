'use server'

import { revalidatePath } from 'next/cache'

import { crearTutorDirecto } from '@/features/auth/lib/crear-tutor-directo'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { permisosDefault } from '@/features/vinculos/schemas/vinculo'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/database'

import { completarDireccionSchema, type CompletarDireccionInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/** Retorno JSON de la RPC `crear_o_anadir_a_familia` (F-2b-1). */
type ResultadoCrearFamilia = {
  resultado: 'familia_creada' | 'nino_anadido' | 'colision'
  familia_id: string | null
  nino_id: string | null
  matricula_id?: string | null
  colision_info: { motivo: string; nombre_existente: string | null } | null
}

/**
 * Éxito de `completarEnDireccion`: alta creada (`ok` con nino_id) o COLISIÓN detectada por
 * la RPC (email ya en el centro con otro nombre) → la UI avisa a Dirección y NO navega.
 */
export type CompletarEnDireccionOk =
  | { resultado: 'ok'; ninoId: string; usuarioId: string }
  | { resultado: 'colision'; nombreExistente: string | null }

/**
 * F11 alta PR-3a "Completa Dirección" (ENTRADA): la Dirección promociona un prospecto a
 * alta real completándola EN NOMBRE del tutor, SIN enviar email. Espejo de `invitarAlAlta`
 * (PR-2), pero en lugar de `sendInvitation` crea la cuenta del tutor con credenciales que
 * pone la propia Dirección (`crearTutorDirecto` → createUser, no inviteUserByEmail). Orquesta:
 *   1. crea un ESQUELETO de niño (centro + nombre/apellidos + fecha_nacimiento del prospecto),
 *   2. crea su MATRÍCULA `pendiente` contra (aula elegida, curso activo),
 *   3. `crearTutorDirecto`: cuenta (email+password) + rol tutor_legal + vínculo tutor↔niño,
 *   4. marca el prospecto como `estado='invitado'` (sale de la cola; no hay estado propio).
 *
 * El wizard y las acciones tutor-only NO se tocan aquí (eso es PR-3b): esta acción solo deja
 * el alta creada y devuelve `ninoId` para que la UI lleve a la ficha (punto de entrada).
 *
 * Todos los INSERT sensibles van por service role (bypass RLS) → gate admin explícito antes.
 * Rollback compensado en cascada si algún paso falla: no deja cuenta/niño/rol/matrícula huérfanos.
 */
export async function completarEnDireccion(
  input: CompletarDireccionInput,
  locale: 'es' | 'en' | 'va' = 'es'
): Promise<ActionResult<CompletarEnDireccionOk>> {
  const parsed = completarDireccionSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')

  const supabase = await createClient()
  const { data: userData, indisponible: authIndisponible } = await llamarGoTrue('getUser', () =>
    supabase.auth.getUser()
  )
  if (authIndisponible) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  // Gate admin del centro (los INSERT van por service role → sin RLS que los cubra).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  // Curso activo del centro (autoritativo server-side; la matrícula va contra él).
  const { data: cursoActivoId } = await supabase.rpc('curso_activo_de_centro', {
    p_centro_id: centroId,
  })
  if (!cursoActivoId) return fail('listaEspera.errors.sin_curso_activo')

  // El aula elegida debe estar configurada en el curso activo (aulas_curso).
  const { data: aulaCurso } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('aula_id', parsed.data.aulaId)
    .eq('curso_academico_id', cursoActivoId)
    .maybeSingle()
  if (!aulaCurso) return fail('listaEspera.errors.aula_invalida')

  // Prospecto (RLS admin lo acota a su centro). Debe estar en espera. A diferencia de
  // invitar, el email NO sale del prospecto: lo teclea la Dirección en el diálogo.
  const { data: prospecto } = await supabase
    .from('lista_espera')
    .select('id, centro_id, nombre_nino, apellidos_nino, fecha_nacimiento, estado')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto || prospecto.centro_id !== centroId)
    return fail('listaEspera.errors.no_encontrado')
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')

  // `fecha_nacimiento` es obligatoria para crear el niño (`ninos.fecha_nacimiento` NOT NULL).
  // Se captura en un const para que el narrowing sobreviva a los `await` posteriores.
  const fechaNacimiento = prospecto.fecha_nacimiento
  if (!fechaNacimiento) return fail('listaEspera.errors.sin_fecha_nacimiento')

  const service = createServiceRoleClient()

  // 1. Cuenta GoTrue PRIMERO (defensiva PR-A vía `crearTutorDirecto`). Si GoTrue falla, no se
  //    escribe nada en BD. Idempotente en reintento: una cuenta `stub` de un intento previo se
  //    reutiliza (no se re-crea). NO se crea niño/matrícula/rol/vínculo/perfil aquí: eso es la RPC.
  const tutor = await crearTutorDirecto(service, {
    email: parsed.data.email,
    password: parsed.data.password,
    // Nombre completo REAL del tutor (nombre + apellidos tecleados por la Dirección).
    nombreCompleto: `${parsed.data.nombreTutor} ${parsed.data.apellidosTutor}`,
    idiomaPreferido: locale,
  })
  if (!tutor.success) return fail(tutor.error)

  // 2. RPC transaccional (cliente AUTENTICADO → `es_admin(auth.uid(), p_centro_id)` autoriza
  //    dentro; `p_centro_id` es server-derivado, no falseable). En UNA transacción crea:
  //    familia + perfil en familia_tutores + niño (familia_id) + matrícula pendiente + vínculo
  //    + rol. Todo-o-nada: aquí NO queda ninguna escritura suelta que duplique lo suyo.
  const { data: rpcData, error: rpcError } = await supabase.rpc('crear_o_anadir_a_familia', {
    p_nombre_nino: prospecto.nombre_nino,
    p_apellidos_nino: prospecto.apellidos_nino ?? '',
    p_fecha_nacimiento: fechaNacimiento,
    p_centro_id: centroId,
    p_aula_id: parsed.data.aulaId,
    p_tutor_email: parsed.data.email,
    p_tutor_nombre_completo: `${parsed.data.nombreTutor} ${parsed.data.apellidosTutor}`,
    p_parentesco: parsed.data.parentesco,
    p_descripcion_parentesco: parsed.data.descripcionParentesco ?? '',
    p_usuario_id: tutor.data.usuarioId,
    p_permisos: permisosDefault('tutor_legal_principal') as Json,
  })
  if (rpcError) {
    // NO se borra la cuenta (frágil): el reintento es idempotente — la RPC es atómica (no dejó
    // residuo en BD) y `crearTutorDirecto` reutiliza la cuenta `stub` en el siguiente intento.
    logger.warn('completarEnDireccion rpc', rpcError.message)
    return fail('listaEspera.errors.alta_fallo')
  }

  const res = rpcData as ResultadoCrearFamilia
  if (res.resultado === 'colision') {
    // Email ya en el centro con OTRO nombre → avisar a Dirección; NO completar (patrón PR-A).
    return ok({
      resultado: 'colision',
      nombreExistente: res.colision_info?.nombre_existente ?? null,
    })
  }

  // 3. El prospecto sale de la cola. Best-effort: si falla, el alta ya está creada; log y
  //    seguimos (el prospecto queda en_espera y se puede descartar a mano).
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado' })
    .eq('id', prospecto.id)
  if (estadoErr) {
    logger.warn('completarEnDireccion estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ resultado: 'ok', ninoId: res.nino_id as string, usuarioId: tutor.data.usuarioId })
}
