'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { crearVinculoSchema, permisosDefault, type CrearVinculoInput } from '../schemas/vinculo'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * B14: admin del centro crea un vínculo familiar entre un niño y un usuario
 * con rol tutor_legal o autorizado. Permisos por defecto según tipo_vinculo:
 * - tutor_legal_*: todos los permisos a true.
 * - autorizado: todos los permisos a false.
 */
export async function crearVinculo(
  ninoId: string,
  input: CrearVinculoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = crearVinculoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'vinculo.validation.invalid')
  }

  const supabase = await createClient()

  // El usuario invitado debe tener un rol activo familiar en el centro del niño.
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!nino) return fail('nino.errors.no_encontrado')

  const { data: rol } = await supabase
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', parsed.data.usuario_id)
    .eq('centro_id', nino.centro_id)
    .is('deleted_at', null)
    .in('rol', ['tutor_legal', 'autorizado'])
    .limit(1)
    .maybeSingle()

  if (!rol) return fail('vinculo.validation.usuario_sin_rol')

  const permisos = permisosDefault(parsed.data.tipo_vinculo)

  const { data, error } = await supabase
    .from('vinculos_familiares')
    .insert({
      nino_id: ninoId,
      usuario_id: parsed.data.usuario_id,
      tipo_vinculo: parsed.data.tipo_vinculo,
      parentesco: parsed.data.parentesco,
      descripcion_parentesco: parsed.data.descripcion_parentesco ?? null,
      permisos,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearVinculo error', error?.message)
    if (error?.code === '23505') return fail('vinculo.errors.duplicado')
    return fail('vinculo.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ id: data.id })
}
