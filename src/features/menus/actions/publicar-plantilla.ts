'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../types'

const inputSchema = z.object({ plantilla_id: z.string().uuid() })

/**
 * Publica una plantilla en `borrador`. Antes archiva la versión
 * `publicada` previa para el mismo (centro, mes, anio) si existe.
 *
 * No usa transacción explícita (supabase-js no la expone): hace dos
 * UPDATEs secuenciales. Riesgo: si el segundo falla, queda un hueco
 * donde el mes pierde plantilla publicada momentáneamente. En la
 * práctica: ambas operaciones tocan filas distintas, fallos son raros.
 *
 * El índice único parcial `WHERE estado='publicada' AND deleted_at IS
 * NULL` garantiza que no pueden coexistir dos publicadas — si el ARCHIVE
 * falla, el PUBLISH falla también con `unique_violation` (23505) y
 * dejamos el estado consistente.
 */
export async function publicarPlantilla(
  input: z.infer<typeof inputSchema>
): Promise<ActionResult<{ id: string }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return fail('menus.toasts.error_publicar')
  }

  const supabase = await createClient()

  const { data: plantilla, error: pErr } = await supabase
    .from('plantillas_menu_mensual')
    .select('id, centro_id, mes, anio, estado')
    .eq('id', parsed.data.plantilla_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (pErr || !plantilla) {
    logger.warn('publicarPlantilla lookup failed', pErr?.message)
    return fail('menus.toasts.error_publicar')
  }
  if (plantilla.estado !== 'borrador') {
    return fail('menus.toasts.error_publicar')
  }

  // Archivar la publicada previa (si existe).
  const { error: archiveErr } = await supabase
    .from('plantillas_menu_mensual')
    .update({ estado: 'archivada' })
    .eq('centro_id', plantilla.centro_id)
    .eq('mes', plantilla.mes)
    .eq('anio', plantilla.anio)
    .eq('estado', 'publicada')
    .is('deleted_at', null)

  if (archiveErr) {
    logger.warn('publicarPlantilla archive previous failed', archiveErr.message)
    return fail('menus.toasts.error_publicar')
  }

  // Publicar la nueva.
  const { error: publishErr } = await supabase
    .from('plantillas_menu_mensual')
    .update({ estado: 'publicada' })
    .eq('id', plantilla.id)

  if (publishErr) {
    logger.warn('publicarPlantilla publish failed', publishErr.message)
    return fail('menus.toasts.error_publicar')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath(`/[locale]/admin/menus/${plantilla.id}`, 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')

  return ok({ id: plantilla.id })
}
