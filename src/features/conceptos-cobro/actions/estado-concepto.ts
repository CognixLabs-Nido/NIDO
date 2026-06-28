'use server'

import { revalidatePath } from 'next/cache'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

// Activar/desactivar un concepto (flag `activo`): reversible, el concepto sigue en el
// catálogo. NO confundir con eliminar (soft-delete con deleted_at).
export async function setActivoConcepto(
  id: string,
  activo: boolean
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conceptos_cobro')
    .update({ activo })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('setActivoConcepto error', error.message)
    if (error.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.errors.update_failed')
  }
  if (!data) return fail('conceptos_cobro.errors.no_encontrado')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ id: data.id })
}

// Eliminar = soft-delete (deleted_at). Libera el nombre (índice único parcial WHERE
// deleted_at IS NULL) y conserva la fila por auditoría. No hay DELETE físico (default DENY).
export async function eliminarConcepto(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conceptos_cobro')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('eliminarConcepto error', error.message)
    if (error.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.errors.delete_failed')
  }
  if (!data) return fail('conceptos_cobro.errors.no_encontrado')

  revalidatePath('/[locale]/admin/cuotas', 'page')
  return ok({ id: data.id })
}
