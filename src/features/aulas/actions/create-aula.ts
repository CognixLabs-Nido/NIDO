'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { aulaSchema, type AulaInput } from '../schemas/aula'
import { fail, ok, type ActionResult } from '../../centros/types'

export async function createAula(
  centroId: string,
  cursoAcademicoId: string,
  input: AulaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = aulaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'aula.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('aulas')
    .insert({
      centro_id: centroId,
      curso_academico_id: cursoAcademicoId,
      nombre: parsed.data.nombre,
      cohorte_anos_nacimiento: parsed.data.cohorte_anos_nacimiento,
      descripcion: parsed.data.descripcion ?? null,
      capacidad_maxima: parsed.data.capacidad_maxima,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('createAula error', error?.message)
    if (error?.code === '23505') return fail('aula.errors.nombre_duplicado')
    return fail('aula.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/aulas', 'page')
  return ok({ id: data.id })
}
