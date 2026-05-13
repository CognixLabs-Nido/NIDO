'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Marca un curso como activo. El índice parcial único
 * idx_un_curso_activo_por_centro garantiza que solo haya uno activo por centro,
 * así que primero cerramos el activo actual (si existe) y luego activamos el
 * indicado. Todo bajo RLS de admin del centro.
 */
export async function activarCurso(cursoId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()

  const { data: curso, error: lookupErr } = await supabase
    .from('cursos_academicos')
    .select('id, centro_id, estado')
    .eq('id', cursoId)
    .maybeSingle()

  if (lookupErr || !curso) {
    logger.warn('activarCurso lookup error', lookupErr?.message)
    return fail('curso.errors.no_encontrado')
  }

  if (curso.estado === 'activo') return ok(undefined)
  if (curso.estado === 'cerrado') {
    return fail('curso.error.no_reabrir_cerrado')
  }

  // Cierra cualquier curso activo del mismo centro.
  const { error: cerrarErr } = await supabase
    .from('cursos_academicos')
    .update({ estado: 'cerrado' })
    .eq('centro_id', curso.centro_id)
    .eq('estado', 'activo')
  if (cerrarErr) {
    logger.warn('activarCurso cerrar previo error', cerrarErr.message)
    return fail('curso.errors.activate_failed')
  }

  const { error: activarErr } = await supabase
    .from('cursos_academicos')
    .update({ estado: 'activo' })
    .eq('id', cursoId)
  if (activarErr) {
    logger.warn('activarCurso error', activarErr.message)
    return fail('curso.errors.activate_failed')
  }

  revalidatePath('/[locale]/admin/cursos', 'page')
  return ok(undefined)
}
