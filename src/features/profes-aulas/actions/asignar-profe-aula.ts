'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { asignarProfeAulaSchema, type AsignarProfeAulaInput } from '../schemas/profe-aula'
import { fail, ok, type ActionResult } from '../../centros/types'

export async function asignarProfeAula(
  aulaId: string,
  input: AsignarProfeAulaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = asignarProfeAulaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'profeAula.validation.invalid')
  }

  const supabase = await createClient()

  // El usuario debe tener rol profe en el centro del aula.
  const { data: aula } = await supabase
    .from('aulas')
    .select('centro_id')
    .eq('id', aulaId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!aula) return fail('aula.errors.no_encontrada')

  const { data: rol } = await supabase
    .from('roles_usuario')
    .select('rol')
    .eq('usuario_id', parsed.data.profe_id)
    .eq('centro_id', aula.centro_id)
    .eq('rol', 'profe')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (!rol) return fail('profeAula.errors.usuario_sin_rol_profe')

  const { data, error } = await supabase
    .from('profes_aulas')
    .insert({
      profe_id: parsed.data.profe_id,
      aula_id: aulaId,
      fecha_inicio: parsed.data.fecha_inicio,
      es_profe_principal: parsed.data.es_profe_principal,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('asignarProfeAula error', error?.message)
    if (error?.code === '23505') return fail('profeAula.errors.ya_principal')
    return fail('profeAula.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/aulas', 'page')
  return ok({ id: data.id })
}
