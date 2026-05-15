'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ausenciaInputSchema, type AusenciaInput } from '../schemas/ausencia'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea una nueva ausencia. RLS exige:
 *  - admin del centro, profe del aula del niño, o
 *  - tutor con permiso `puede_reportar_ausencias` y `fecha_inicio >= hoy`.
 *
 * El servidor inyecta `reportada_por = auth.uid()`.
 */
export async function crearAusencia(input: AusenciaInput): Promise<ActionResult<{ id: string }>> {
  const parsed = ausenciaInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'ausencia.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  const { data, error } = await supabase
    .from('ausencias')
    .insert({
      nino_id: parsed.data.nino_id,
      fecha_inicio: parsed.data.fecha_inicio,
      fecha_fin: parsed.data.fecha_fin,
      motivo: parsed.data.motivo,
      descripcion: parsed.data.descripcion,
      reportada_por: userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('crearAusencia failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('ausencia.errors.sin_permiso')
    }
    return fail('ausencia.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  return ok({ id: data.id })
}
