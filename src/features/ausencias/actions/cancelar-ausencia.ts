'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { PREFIX_CANCELADA, esCancelada } from '../schemas/ausencia'
import { fail, ok, type ActionResult } from '../types'

/**
 * Cancela una ausencia en sitio: añade prefijo `[cancelada] ` a la
 * descripción si no lo tiene. NO borra la fila — borrado bloqueado por
 * default DENY a todos los roles, queda en audit_log.
 *
 * Cualquier rol con UPDATE sobre la ausencia (admin, tutor con permiso,
 * profe si la creó) puede cancelar la suya.
 */
export async function cancelarAusencia(id: string): Promise<ActionResult<{ id: string }>> {
  if (!id) return fail('ausencia.errors.id_requerido')

  const supabase = await createClient()
  const { data: actual } = await supabase
    .from('ausencias')
    .select('id, descripcion')
    .eq('id', id)
    .single()

  if (!actual) return fail('ausencia.errors.no_encontrada')
  if (esCancelada(actual.descripcion)) return ok({ id: actual.id })

  const nuevaDescripcion = `${PREFIX_CANCELADA}${actual.descripcion ?? ''}`
  const { data, error } = await supabase
    .from('ausencias')
    .update({ descripcion: nuevaDescripcion })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('cancelarAusencia failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('ausencia.errors.sin_permiso')
    }
    return fail('ausencia.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  return ok({ id: data.id })
}
