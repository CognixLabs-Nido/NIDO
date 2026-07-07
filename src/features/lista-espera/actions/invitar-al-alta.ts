'use server'

import { revalidatePath } from 'next/cache'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { invitarAlAltaSchema, type InvitarAlAltaInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3 "invitar al alta" (PR-2: aula al invitar): promociona un prospecto de la
 * lista de espera a alta real, fijando ya su aula del curso activo. Orquesta:
 *   1. crea un ESQUELETO de niño (centro + nombre + fecha_nacimiento del prospecto),
 *   2. crea su MATRÍCULA `pendiente` contra (aula elegida, curso activo) — al validar
 *      la documentación la dirección la activa y el niño queda dentro,
 *   3. dispara `sendInvitation` (rol_objetivo='tutor_legal', plantilla email neutral),
 *   4. marca el prospecto como `estado='invitado'`.
 *
 * El aviso de capacidad (aforo del aula) es una confirmación en la UI, NO un bloqueo
 * aquí (la capacidad de `aulas_curso` es informativa). Los INSERT van por service role
 * (bypass RLS) → gate admin explícito antes. Rollback en cascada si algún paso falla.
 */
export async function invitarAlAlta(
  input: InvitarAlAltaInput,
  locale: string = 'es'
): Promise<ActionResult<{ ninoId: string; invitationId: string }>> {
  const parsed = invitarAlAltaSchema.safeParse(input)
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

  // El aula elegida debe estar configurada en el curso activo (aulas_curso). Además de
  // dar un error claro, evita apoyarse solo en la FK compuesta de matriculas.
  const { data: aulaCurso } = await supabase
    .from('aulas_curso')
    .select('aula_id')
    .eq('aula_id', parsed.data.aulaId)
    .eq('curso_academico_id', cursoActivoId)
    .maybeSingle()
  if (!aulaCurso) return fail('listaEspera.errors.aula_invalida')

  // Prospecto (RLS admin lo acota a su centro). Debe estar en espera y tener email.
  const { data: prospecto } = await supabase
    .from('lista_espera')
    .select('id, centro_id, nombre_nino, apellidos_nino, fecha_nacimiento, email_tutor, estado')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!prospecto || prospecto.centro_id !== centroId)
    return fail('listaEspera.errors.no_encontrado')
  if (prospecto.estado !== 'en_espera') return fail('listaEspera.errors.no_en_espera')
  if (!prospecto.email_tutor) return fail('listaEspera.errors.sin_email')

  const service = createServiceRoleClient()

  // 1. Esqueleto de niño con nombre y apellidos SEPARADOS (PR-4c-1). Prospectos previos a la
  //    columna `apellidos_nino` la traen NULL → `ninos.apellidos` queda NULL (nullable desde
  //    P2b); el tutor lo completa en el wizard (editable en 4c-2). No rompe la invitación.
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
    logger.warn('invitarAlAlta nino insert', ninoErr?.message)
    return fail('nino.errors.create_failed')
  }

  // 2. Matrícula PENDIENTE contra (aula elegida, curso activo). La FK compuesta
  //    (aula_id, curso_academico_id) → aulas_curso ya la validamos arriba. El niño es
  //    nuevo → no hay matrícula previa para ese niño+curso (el índice único parcial
  //    (nino_id, curso) protege de duplicados si se reintentara).
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
    logger.warn('invitarAlAlta matricula insert', matErr?.message)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail('matricula.errors.create_failed')
  }

  // 3. Invitación (reusa sendInvitation: dedupe nino_id-aware + email neutral).
  const inv = await sendInvitation(
    {
      email: prospecto.email_tutor,
      rolObjetivo: 'tutor_legal',
      centroId,
      ninoId: nino.id,
      tipoVinculo: 'tutor_legal_principal',
    },
    locale
  )
  if (!inv.success) {
    await service.from('matriculas').delete().eq('id', matricula.id)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail(inv.error)
  }

  // 4. El prospecto pasa a invitado.
  const { error: estadoErr } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado' })
    .eq('id', prospecto.id)
  if (estadoErr) {
    // La invitación ya salió; no revertimos al tutor. Log y seguimos (el prospecto
    // queda en_espera; reintentar es idempotente vía dedupe de sendInvitation).
    logger.warn('invitarAlAlta estado update', estadoErr.message)
  }

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ ninoId: nino.id, invitationId: inv.data.invitationId })
}
