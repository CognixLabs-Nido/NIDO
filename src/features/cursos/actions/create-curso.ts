'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { createCursoSchema, type CreateCursoInput } from '../schemas/curso'
import { fail, ok, type ActionResult } from '../../centros/types'

export async function createCurso(
  centroId: string,
  input: CreateCursoInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = createCursoSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'curso.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cursos_academicos')
    .insert({
      centro_id: centroId,
      nombre: parsed.data.nombre,
      fecha_inicio: parsed.data.fecha_inicio,
      fecha_fin: parsed.data.fecha_fin,
      estado: 'planificado',
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('createCurso error', error?.message)
    if (error?.code === '23505') return fail('curso.errors.nombre_duplicado')
    return fail('curso.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/cursos', 'page')
  return ok({ id: data.id })
}
