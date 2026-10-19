'use server'

import { revalidatePath } from 'next/cache'

import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
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

  // El centro es el DE LA FAMILIA del tutor, no el centro activo de la cookie. La RLS solo deja
  // leer a Dirección los tutores y las familias de sus centros.
  const { data: tutor } = await supabase
    .from('familia_tutores')
    .select('familia_id')
    .eq('id', parsed.data.tutor_id)
    .is('deleted_at', null)
    .maybeSingle()
  const { data: familia } = tutor
    ? await supabase.from('familias').select('centro_id').eq('id', tutor.familia_id).maybeSingle()
    : { data: null }
  if (!familia) return fail('admin.familias.errors.tutor_no_encontrado')
  if (!(await esAdminEn(supabase, userData.user.id, familia.centro_id)))
    return fail('auth.invitation.errors.forbidden')

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
