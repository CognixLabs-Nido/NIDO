'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  invitarFamiliaConEsqueletoSchema,
  type InvitarFamiliaConEsqueletoInput,
} from '../schemas/invitation'

import { sendInvitation } from './send-invitation'
import { fail, ok, type ActionResult } from './types'
import { createServiceRoleClient } from './_service-role'

/**
 * Alta tutor-driven (Pieza 2b). La dirección invita a la familia creando, en una
 * sola operación orquestada:
 *   1. un ESQUELETO de niño (solo `centro_id` + `nombre`; identidad la completa el tutor),
 *   2. su matrícula en el aula con `estado='pendiente'` (`fecha_alta=hoy`; el curso se
 *      deriva del aula),
 *   3. la invitación (`rol_objetivo='tutor_legal'` + `nino_id` + `tipo_vinculo`) reusando
 *      `sendInvitation` (dedupe nino_id-aware + email).
 *
 * Sin transacciones desde el cliente Supabase: si un paso posterior falla, se deshacen
 * los previos a mano. Los INSERT van por service role (bypass RLS) → gate admin explícito.
 * NO instancia la autorización de imagen (se hace lazy en el paso del wizard, pieza posterior).
 */
export async function invitarFamiliaConEsqueleto(
  input: InvitarFamiliaConEsqueletoInput,
  locale: string = 'es'
): Promise<ActionResult<{ ninoId: string; invitationId: string }>> {
  const parsed = invitarFamiliaConEsqueletoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'auth.validation.invalid')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('auth.invitation.errors.forbidden')

  // Gate admin del centro (los INSERT van por service role → no hay RLS que lo cubra).
  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  const service = createServiceRoleClient()

  // 1. Aula → curso (y verificación de centro).
  const { data: aula, error: aulaErr } = await service
    .from('aulas')
    .select('id, curso_academico_id, centro_id')
    .eq('id', parsed.data.aulaId)
    .is('deleted_at', null)
    .maybeSingle()
  if (aulaErr || !aula) return fail('nino.errors.aula_no_encontrada')
  if (aula.centro_id !== centroId) return fail('nino.errors.aula_de_otro_centro')

  // 2. Esqueleto de niño (apellidos/fecha_nacimiento NULL → los completa el tutor).
  const { data: nino, error: ninoErr } = await service
    .from('ninos')
    .insert({ centro_id: centroId, nombre: parsed.data.nombreNino })
    .select('id')
    .single()
  if (ninoErr || !nino) {
    logger.warn('invitarFamiliaConEsqueleto nino insert error', ninoErr?.message)
    return fail('nino.errors.create_failed')
  }

  // 3. Matrícula pendiente (fecha_alta=hoy; activar = flip estado → Pieza 4 con wizard).
  const hoy = new Date().toISOString().slice(0, 10)
  const { error: matErr } = await service.from('matriculas').insert({
    nino_id: nino.id,
    aula_id: aula.id,
    curso_academico_id: aula.curso_academico_id,
    fecha_alta: hoy,
    estado: 'pendiente',
  })
  if (matErr) {
    logger.warn('invitarFamiliaConEsqueleto matricula error', matErr.message)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail('matricula.errors.create_failed')
  }

  // 4. Invitación (reusa sendInvitation: dedupe nino_id-aware + email).
  const inv = await sendInvitation(
    {
      email: parsed.data.email,
      rolObjetivo: 'tutor_legal',
      centroId,
      ninoId: nino.id,
      aulaId: aula.id,
      tipoVinculo: parsed.data.tipoVinculo,
    },
    locale
  )
  if (!inv.success) {
    // Rollback encadenado: borra la matrícula y soft-delete del esqueleto.
    await service.from('matriculas').delete().eq('nino_id', nino.id)
    await service.from('ninos').update({ deleted_at: new Date().toISOString() }).eq('id', nino.id)
    return fail(inv.error)
  }

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ ninoId: nino.id, invitationId: inv.data.invitationId })
}
