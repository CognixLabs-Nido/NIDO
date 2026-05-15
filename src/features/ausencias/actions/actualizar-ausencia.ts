'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ausenciaInputSchema, type AusenciaInput } from '../schemas/ausencia'
import { fail, ok, type ActionResult } from '../types'

/**
 * Actualiza una ausencia existente. RLS:
 *  - admin del centro siempre
 *  - tutor con permiso si la fecha_inicio no ha pasado todavía
 *  - profe SOLO si `reportada_por = auth.uid()` (su propia ausencia)
 *
 * Adicionalmente, si la llamada viene de profe, server-side enforzamos
 * que el único cambio aceptado es cancelar (prefijar `[cancelada] `) —
 * para eso existe `cancelarAusencia`. Esta action es la "modificación
 * libre" que solo admin/tutor pueden usar.
 */
export async function actualizarAusencia(
  input: AusenciaInput
): Promise<ActionResult<{ id: string }>> {
  if (!input.id) return fail('ausencia.errors.id_requerido')

  const parsed = ausenciaInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'ausencia.errors.guardar_fallo')
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ausencias')
    .update({
      fecha_inicio: parsed.data.fecha_inicio,
      fecha_fin: parsed.data.fecha_fin,
      motivo: parsed.data.motivo,
      descripcion: parsed.data.descripcion,
    })
    .eq('id', parsed.data.id!)
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('actualizarAusencia failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('ausencia.errors.sin_permiso')
    }
    return fail('ausencia.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  return ok({ id: data.id })
}
