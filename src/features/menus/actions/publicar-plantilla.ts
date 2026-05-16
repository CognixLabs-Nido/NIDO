'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../types'

/**
 * Publica una plantilla. Si ya hay otra publicada en el mismo centro, la
 * archiva primero. El índice parcial único `(centro_id) WHERE estado='publicada'`
 * impone la invariante; aquí garantizamos la transición en dos UPDATEs.
 *
 * Nota: no es estrictamente transaccional desde el cliente Supabase JS
 * (no hay `begin/commit` expuesto). Si el segundo UPDATE falla, la
 * publicada anterior ya quedó archivada. Para Ola 1 es aceptable: el
 * admin reintenta. Cuando se quiera atomicidad estricta, se mueve a una
 * función SQL `publicar_plantilla(p_id uuid)` SECURITY DEFINER.
 */
export async function publicarPlantilla(
  plantillaId: string
): Promise<ActionResult<{ id: string }>> {
  if (!plantillaId) return fail('menus.errors.id_requerido')

  const supabase = await createClient()

  // 1. Recuperar centro_id de la plantilla a publicar (vía RLS — admin del
  //    centro lo verá).
  const { data: target, error: targetErr } = await supabase
    .from('plantillas_menu')
    .select('id, centro_id, estado')
    .eq('id', plantillaId)
    .is('deleted_at', null)
    .single()

  if (targetErr || !target) {
    logger.warn('publicarPlantilla — target no encontrado', targetErr?.message)
    return fail('menus.errors.no_encontrada')
  }
  if (target.estado === 'publicada') {
    return ok({ id: target.id })
  }
  if (target.estado === 'archivada') {
    return fail('menus.errors.publicar_archivada')
  }

  // 2. Archivar la publicada previa (si existe). UPDATE de muchas a 1 fila
  //    como máximo gracias al índice parcial único.
  const { error: archErr } = await supabase
    .from('plantillas_menu')
    .update({ estado: 'archivada' })
    .eq('centro_id', target.centro_id)
    .eq('estado', 'publicada')

  if (archErr) {
    logger.warn('publicarPlantilla — archivar previa falló', archErr.message)
    if (archErr.code === '42501' || archErr.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.publicar_fallo')
  }

  // 3. Publicar la nueva.
  const { data, error } = await supabase
    .from('plantillas_menu')
    .update({ estado: 'publicada' })
    .eq('id', plantillaId)
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('publicarPlantilla — publicar falló', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('menus.errors.sin_permiso')
    }
    return fail('menus.errors.publicar_fallo')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath('/[locale]/admin/menus/[id]', 'page')
  revalidatePath('/[locale]/admin', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}
