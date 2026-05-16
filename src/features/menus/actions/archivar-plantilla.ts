'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../types'

/**
 * Archiva una plantilla (estado='archivada'). Disponible para plantillas
 * en borrador o publicadas. Una vez archivada NO se puede reabrir desde
 * la app (decisión del producto). RLS exige admin del centro.
 */
export async function archivarPlantilla(
  plantillaId: string
): Promise<ActionResult<{ id: string }>> {
  if (!plantillaId) return fail('menus.errors.id_requerido')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plantillas_menu')
    .update({ estado: 'archivada' })
    .eq('id', plantillaId)
    .neq('estado', 'archivada')
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('archivarPlantilla failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.archivar_fallo')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath('/[locale]/admin/menus/[id]', 'page')
  revalidatePath('/[locale]/admin', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}
