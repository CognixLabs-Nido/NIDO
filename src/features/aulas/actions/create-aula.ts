'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { aulaSchema, type AulaInput } from '../schemas/aula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-H: crear un aula = crear la sala física (`aulas`) + su configuración en el
 * curso activo (`aulas_curso`: tramo de edad + capacidad) en un solo paso
 * (decisión usuario 2026-06-24). Sin transacciones desde el cliente Supabase: si
 * falla el segundo INSERT, se compensa borrando la sala recién creada.
 */
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

  // 1) Sala física.
  const { data: aula, error: aulaErr } = await supabase
    .from('aulas')
    .insert({
      centro_id: centroId,
      nombre: parsed.data.nombre,
      descripcion: parsed.data.descripcion ?? null,
    })
    .select('id')
    .single()

  if (aulaErr || !aula) {
    logger.warn('createAula aula error', aulaErr?.message)
    if (aulaErr?.code === '23505') return fail('aula.errors.nombre_duplicado')
    return fail('aula.errors.create_failed')
  }

  // 2) Configuración en el curso activo.
  const { error: cursoErr } = await supabase.from('aulas_curso').insert({
    centro_id: centroId,
    aula_id: aula.id,
    curso_academico_id: cursoAcademicoId,
    tramo_edad: parsed.data.cohorte_anos_nacimiento,
    capacidad: parsed.data.capacidad_maxima,
  })

  if (cursoErr) {
    logger.warn('createAula aulas_curso error', cursoErr.message)
    // Compensación: la sala quedó huérfana sin configuración → la retiramos.
    await supabase.from('aulas').delete().eq('id', aula.id)
    return fail('aula.errors.create_failed')
  }

  revalidatePath('/[locale]/admin/aulas', 'page')
  return ok({ id: aula.id })
}
