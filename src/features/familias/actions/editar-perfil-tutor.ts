'use server'

import { revalidatePath } from 'next/cache'

import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { editarPerfilTutorSchema, type EditarPerfilTutorInput } from '../schemas/editar-familia'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-6a — Dirección edita el perfil de un tutor de `familia_tutores`: identidad, dirección y, desde la
 * fase 6, teléfono, fecha de nacimiento, número del DNI, estudios y empresa. Por `guardar_tutor`, que
 * deja escribir a la Dirección del centro (también con el alta validada: es quien aprueba la cola).
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
    .select('familia_id, rol_familia')
    .eq('id', parsed.data.tutor_id)
    .is('deleted_at', null)
    .maybeSingle()
  const { data: familia } = tutor
    ? await supabase.from('familias').select('centro_id').eq('id', tutor.familia_id).maybeSingle()
    : { data: null }
  if (!familia) return fail('admin.familias.errors.tutor_no_encontrado')
  if (!(await esAdminEn(supabase, userData.user.id, familia.centro_id)))
    return fail('auth.invitation.errors.forbidden')

  // Por `guardar_tutor` (fase 6): la misma forma y los mismos CHECK que el alta, también los cinco
  // nuevos. No toca `usuario_id` / `rol_familia` / `familia_id` ni la ruta del DNI (no los acepta).
  const p = parsed.data
  const v = (x: string | null | undefined) => (x && x.trim() !== '' ? x.trim() : null)
  const { data: id, error } = await supabase.rpc('guardar_tutor', {
    p_familia_id: tutor!.familia_id,
    p_rol_familia: tutor!.rol_familia,
    p_datos: {
      nombre_completo: p.nombre_completo,
      email: p.email,
      direccion_calle: v(p.direccion_calle),
      direccion_numero: v(p.direccion_numero),
      direccion_cp: v(p.direccion_cp),
      direccion_ciudad: v(p.direccion_ciudad),
      // Los cinco nuevos solo si vienen: sin leerlos, el diálogo no los manda y no se pisan.
      ...Object.fromEntries(
        (['telefono', 'fecha_nacimiento', 'dni_numero', 'estudios', 'empresa'] as const)
          .filter((c) => p[c] !== undefined)
          .map((c) => [c, v(p[c])])
      ),
    },
  })
  if (error) {
    logger.warn('editarPerfilTutor', error.code ?? 'sin_codigo')
    if (error.hint === 'fecha_nacimiento_fuera_de_rango')
      return fail('alta.tutor.errors.fecha_nacimiento')
    if (error.message.includes('familia_tutores_telefono_formato'))
      return fail('alta.tutor.errors.telefono')
    if (error.message.includes('familia_tutores_dni_numero_valido'))
      return fail('alta.tutor.errors.dni_numero')
    if (error.code === '42501') return fail('admin.familias.errors.no_autorizado')
    return fail('admin.familias.errors.guardado')
  }
  if (!id) return fail('admin.familias.errors.tutor_no_encontrado')

  revalidatePath('/[locale]/admin/familias', 'page')
  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  return ok({ id })
}
