'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { tieneRolFamiliarEn } from '@/features/centros/contexto/roles-de-otros'
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

  if (!(await tieneRolFamiliarEn(supabase, parsed.data.usuario_id, nino.centro_id)))
    return fail('vinculo.validation.usuario_sin_rol')

  const permisos = permisosDefault(parsed.data.tipo_vinculo)

  // Por la RPC que aplica la tabla de motivos de la BD: un vínculo retirado se reactiva o se crea
  // de nuevo según su motivo (antes, el INSERT daba 23505 y salía «duplicado»). Uno vivo sigue
  // siendo un duplicado (23505).
  const { data, error } = await supabase.rpc('crear_vinculo', {
    p_nino_id: ninoId,
    p_usuario_id: parsed.data.usuario_id,
    p_tipo: parsed.data.tipo_vinculo,
    p_parentesco: parsed.data.parentesco,
    p_descripcion_parentesco: (parsed.data.descripcion_parentesco ?? null) as string,
    p_permisos: permisos,
  })

  if (error || !data) {
    logger.warn('crearVinculo error', error?.message)
    if (error?.code === '23505') return fail('vinculo.errors.duplicado')
    return fail('vinculo.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/ninos', 'page')
  return ok({ id: data })
}
