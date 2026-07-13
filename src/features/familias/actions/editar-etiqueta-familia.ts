'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
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

  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')

  const { data: roles } = await supabase
    .from('roles_usuario')
    .select('rol, centro_id')
    .eq('usuario_id', userData.user.id)
    .is('deleted_at', null)
  const isAdmin = roles?.some((r) => r.centro_id === centroId && r.rol === 'admin')
  if (!isAdmin) return fail('auth.invitation.errors.forbidden')

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
