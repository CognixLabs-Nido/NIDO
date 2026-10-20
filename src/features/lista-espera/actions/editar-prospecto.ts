'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { esAdminDelCentro } from '../lib/authz-admisiones'
import { resolverTutorPorEmail } from '../lib/resolver-tutor-email'
import { editarProspectoSchema, type EditarProspectoInput } from '../schemas/lista-espera'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H-3: edita los datos de un prospecto. No toca `posicion`, `estado`, `curso`
 * ni `centro` (eso lo gestionan reordenar/invitar/descartar). RLS limita a admin.
 *
 * PR 1 (Fase 4): `tutor_usuario_id` lo decide el email. Si la directora cambia el email, se
 * vuelve a resolver con la misma regla que al crear (`resolverTutorPorEmail`): antes se quedaba la
 * cuenta del email anterior, y al promover el niño entraba en una familia que ya no era la suya.
 */
export async function editarProspecto(
  input: EditarProspectoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = editarProspectoSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'listaEspera.validation.invalid')
  const data = parsed.data

  const supabase = await createClient()
  const { data: actual } = await supabase
    .from('lista_espera')
    .select('centro_id, email_tutor')
    .eq('id', data.id)
    .maybeSingle()
  if (!actual) return fail('listaEspera.errors.no_encontrado')

  const cambios: Database['public']['Tables']['lista_espera']['Update'] = {
    nombre_nino: data.nombre_nino,
    apellidos_nino: data.apellidos_nino,
    fecha_nacimiento: data.fecha_nacimiento,
    telefono_tutor: data.telefono_tutor,
    email_tutor: data.email_tutor,
    nota: data.nota,
  }

  const normalizar = (e: string | null) => (e ?? '').trim().toLowerCase()
  if (normalizar(data.email_tutor) !== normalizar(actual.email_tutor)) {
    // La resolución lee por service role: gate admin explícito, como en `crearProspecto`.
    if (!(await esAdminDelCentro(supabase, actual.centro_id)))
      return fail('auth.invitation.errors.forbidden')
    const tutor = await resolverTutorPorEmail(
      createServiceRoleClient(),
      data.email_tutor,
      actual.centro_id
    )
    if (!tutor) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')
    cambios.tutor_usuario_id = tutor.tutorUsuarioId
  }

  const { data: actualizado, error } = await supabase
    .from('lista_espera')
    .update(cambios)
    .eq('id', data.id)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.warn('editarProspecto update', error.message)
    return fail('listaEspera.errors.editar_fallo')
  }
  if (!actualizado) return fail('listaEspera.errors.no_encontrado')

  revalidatePath('/[locale]/admin/admisiones', 'page')
  return ok({ id: actualizado.id })
}
