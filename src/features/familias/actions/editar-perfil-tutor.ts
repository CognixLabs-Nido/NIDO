'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { editarPerfilTutorSchema, type EditarPerfilTutorInput } from '../schemas/editar-familia'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-6a — Dirección edita el perfil (identidad + dirección) de un tutor de `familia_tutores`.
 * UPDATE directo (la RLS `familia_tutores_update` por `es_admin(centro_de_familia)` autoriza).
 * El UPDATE lista SOLO los campos editables: NO toca `usuario_id`/`rol_familia`/`familia_id`
 * (los congela el trigger `familia_tutores_proteger_usuario_id`) ni `dni_documento_path`.
 */
export async function editarPerfilTutor(
  input: EditarPerfilTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = editarPerfilTutorSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'admin.familias.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

  // SOLO identidad + dirección. Sin usuario_id/rol_familia/familia_id (congelados por trigger).
  const { data, error } = await supabase
    .from('familia_tutores')
    .update({
      nombre_completo: parsed.data.nombre_completo,
      email: parsed.data.email,
      direccion_calle: parsed.data.direccion_calle ?? null,
      direccion_numero: parsed.data.direccion_numero ?? null,
      direccion_cp: parsed.data.direccion_cp ?? null,
      direccion_ciudad: parsed.data.direccion_ciudad ?? null,
    })
    .eq('id', parsed.data.tutor_id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarPerfilTutor', error.message)
    if (error.code === '42501') return fail('admin.familias.errors.no_autorizado')
    return fail('admin.familias.errors.guardado')
  }
  // RLS USING falso (tutor de otro centro) o fila inexistente → 0 filas, sin error.
  if (!data) return fail('admin.familias.errors.tutor_no_encontrado')

  revalidatePath('/[locale]/admin/familias', 'page')
  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  return ok({ id: data.id })
}
