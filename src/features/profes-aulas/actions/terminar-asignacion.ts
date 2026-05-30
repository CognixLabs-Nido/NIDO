'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { terminarAsignacionSchema, type TerminarAsignacionInput } from '../schemas/profe-aula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Retira a una persona de su aula (D6: soft delete vía `fecha_fin`, no hard
 * delete — conserva el histórico de quién estuvo en qué aula y cuándo).
 *
 * `fecha_fin = hoyMadrid()`. La fila deja de ser "activa"
 * (`fecha_fin IS NULL`) y desaparece de `getPersonalAula` / del índice de
 * coordinadora, pero permanece en BD para informes y trazabilidad.
 *
 * RLS `profes_aulas_admin_all` garantiza que el admin solo puede tocar
 * filas de su centro. Si la fila no existe, no es suya, o ya está
 * terminada, el UPDATE afecta a 0 filas → `data === null` (gotcha "USING
 * falso → 0 filas, sin error", ADR-0030/0031).
 */
export async function terminarAsignacion(
  input: TerminarAsignacionInput
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const r = await terminarAsignacionCore(supabase, input)
  if (r.success) revalidatePath('/[locale]/admin/aulas', 'page')
  return r
}

/** Núcleo testeable (cliente inyectable; sin `revalidatePath`). */
export async function terminarAsignacionCore(
  supabase: SupabaseClient<Database>,
  input: TerminarAsignacionInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = terminarAsignacionSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'profeAula.validation.invalid')
  }

  const { data, error } = await supabase
    .from('profes_aulas')
    .update({ fecha_fin: hoyMadrid() })
    .eq('id', parsed.data.asignacion_id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('terminarAsignacion error', error.message)
    return fail('profeAula.errors.terminar_fallo')
  }
  if (!data) return fail('profeAula.errors.asignacion_no_encontrada')

  return ok({ id: data.id })
}
