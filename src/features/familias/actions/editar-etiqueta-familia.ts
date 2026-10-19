'use server'

import { revalidatePath } from 'next/cache'

import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  editarEtiquetaFamiliaSchema,
  type EditarEtiquetaFamiliaInput,
} from '../schemas/editar-familia'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-6a — Dirección edita la etiqueta de una familia. UPDATE directo (la RLS `familias_update`
 * por `es_admin(centro_id)` ya autoriza; el cliente de sesión lleva `auth.uid()` del admin).
 * Gate admin explícito de defensa en profundidad. Solo toca `etiqueta`.
 */
export async function editarEtiquetaFamilia(
  input: EditarEtiquetaFamiliaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = editarEtiquetaFamiliaSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'admin.familias.validation.invalid')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  // El centro es el DE LA FAMILIA, no el centro activo de la cookie. La RLS solo deja leer a
  // Dirección las familias de sus centros.
  const { data: familia } = await supabase
    .from('familias')
    .select('centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia) return fail('admin.familias.errors.no_encontrada')
  if (!(await esAdminEn(supabase, userData.user.id, familia.centro_id)))
    return fail('auth.invitation.errors.forbidden')

  const { data, error } = await supabase
    .from('familias')
    .update({ etiqueta: parsed.data.etiqueta })
    .eq('id', parsed.data.familia_id)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('editarEtiquetaFamilia', error.message)
    if (error.code === '42501') return fail('admin.familias.errors.no_autorizado')
    return fail('admin.familias.errors.guardado')
  }
  // RLS USING falso (familia de otro centro) → 0 filas, sin error.
  if (!data) return fail('admin.familias.errors.no_encontrada')

  revalidatePath('/[locale]/admin/familias', 'page')
  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  return ok({ id: data.id })
}
