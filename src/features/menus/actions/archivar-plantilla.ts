'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../types'

const inputSchema = z.object({ plantilla_id: z.string().uuid() })

/**
 * Archiva manualmente una plantilla (borrador o publicada) → estado
 * `archivada`. DELETE no se permite (RLS bloquea), por lo que esto es
 * la forma de "quitar de en medio" una plantilla antigua sin perder
 * sus filas históricas para auditoría.
 */
export async function archivarPlantilla(
  input: z.infer<typeof inputSchema>
): Promise<ActionResult<{ id: string }>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return fail('menus.toasts.error_guardar')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantillas_menu_mensual')
    .update({ estado: 'archivada' })
    .eq('id', parsed.data.plantilla_id)
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('archivarPlantilla failed', error?.message)
    return fail('menus.toasts.error_guardar')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath(`/[locale]/admin/menus/${parsed.data.plantilla_id}`, 'page')
  return ok({ id: data.id })
}
