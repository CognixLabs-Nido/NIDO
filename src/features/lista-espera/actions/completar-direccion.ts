'use server'

import { revalidatePath } from 'next/cache'

import { crearTutorDirecto } from '@/features/auth/lib/crear-tutor-directo'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { completarDireccionSchema, type CompletarDireccionInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

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
): Promise<ActionResult<{ ninoId: string; usuarioId: string }>> {
  const parsed = completarDireccionSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('auth.invitation.errors.unauthenticated')

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

  const service = createServiceRoleClient()

  // Pre-chequeo: email ya registrado → fallamos ANTES de crear niño/matrícula (evita el
  // churn de crear+revertir en el error más común). `createUser` es el guard autoritativo
  // (cubre el borde de un email en la página 2 de listUsers), y ahí el rollback igual limpia.
  const { data: existentes } = await service.auth.admin.listUsers()
  const yaExiste = existentes.users.some(
    (u) => u.email?.toLowerCase() === parsed.data.email.toLowerCase()
  )
  if (yaExiste) return fail('auth.invitation.errors.email_already_registered')

  // 1. Esqueleto de niño (nombre + apellidos separados, PR-4c-1; apellidos puede ser NULL
  //    en prospectos antiguos → el tutor lo completa en el wizard).
  const { data: nino, error: ninoErr } = await service
    .from('ninos')
    .insert({
      centro_id: centroId,
      nombre: prospecto.nombre_nino,
      apellidos: prospecto.apellidos_nino,
      fecha_nacimiento: prospecto.fecha_nacimiento,
    })
    .select('id')
    .single()
  if (ninoErr || !nino) {
    logger.warn('completarEnDireccion nino insert', ninoErr?.message)
    return fail('nino.errors.create_failed')
  }

  // 2. Matrícula PENDIENTE contra (aula elegida, curso activo).
  const { data: matricula, error: matErr } = await service
    .from('matriculas')
    .insert({
      nino_id: nino.id,
      aula_id: parsed.data.aulaId,
      curso_academico_id: cursoActivoId,
      estado: 'pendiente',
    })
    .select('id')
    .single()
  if (matErr || !matricula) {
    logger.warn('completarEnDireccion matricula insert', matErr?.message)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail('matricula.errors.create_failed')
  }

  // 3. Cuenta del tutor + rol + vínculo (SIN email). Rollback interno de la cuenta si falla
  //    rol/vínculo; aquí revertimos niño + matrícula si `crearTutorDirecto` devuelve error.
  const tutor = await crearTutorDirecto(service, {
    email: parsed.data.email,
    password: parsed.data.password,
    centroId,
    ninoId: nino.id,
    parentesco: parsed.data.parentesco,
    descripcionParentesco: parsed.data.descripcionParentesco ?? null,
    idiomaPreferido: locale,
  })
  if (!tutor.success) {
    await service.from('matriculas').delete().eq('id', matricula.id)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail(tutor.error)
  }

  // 4. El prospecto sale de la cola. Best-effort: si falla, el alta ya está creada; log y
  //    seguimos (el prospecto queda en_espera y se puede descartar a mano).
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado' })
    .eq('id', prospecto.id)
  if (estadoErr) {
    logger.warn('completarEnDireccion estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ ninoId: nino.id, usuarioId: tutor.data.usuarioId })
}
