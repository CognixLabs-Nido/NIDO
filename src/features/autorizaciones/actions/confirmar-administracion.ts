'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { revalidarAutorizaciones } from '../lib/server-helpers'
import {
  confirmarAdministracionSchema,
  type ConfirmarAdministracionInput,
} from '../schemas/autorizaciones'
import { fail, ok, type ActionResult } from '../types'

/**
 * **F8-3b — Confirmar una administración (2.º staff).** Doble confirmación real:
 * la confirma un staff DISTINTO del que la administró, autenticado. Único UPDATE
 * permitido (pendiente → confirmada); el trigger congela el resto de columnas y
 * fija `confirmado_at`. Guardas en BD:
 *
 *   - RLS USING: solo filas pendientes (`confirmado_por` NULL) y
 *     `administrado_por <> auth.uid()` (no autoconfirmar) + staff del niño.
 *   - WITH CHECK: `confirmado_por = auth.uid()` (anti-suplantación) + CHECK de BD
 *     `confirmado_por <> administrado_por`.
 *
 * "USING falso → 0 filas": si ya está confirmada, o soy quien la administró, o no
 * soy staff del niño, el UPDATE no toca nada → `data` null → error de permiso.
 */
export async function confirmarAdministracion(
  input: ConfirmarAdministracionInput
): Promise<ActionResult<{ administracion_id: string }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('autorizaciones.errors.no_autorizado')

  const parsed = confirmarAdministracionSchema.safeParse(input)
  if (!parsed.success) return fail('autorizaciones.errors.adm_confirmar_fallo')
  const d = parsed.data

  const { data: row, error } = await supabase
    .from('administraciones_medicacion')
    .update({ confirmado_por: user.id })
    .eq('id', d.administracion_id)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.warn('confirmarAdministracion: update', error.message)
    if (error.code === '42501') return fail('autorizaciones.errors.adm_confirmar_no_permitido')
    return fail('autorizaciones.errors.adm_confirmar_fallo')
  }
  // 0 filas: ya confirmada / soy quien administró / no soy staff del niño.
  if (!row) return fail('autorizaciones.errors.adm_confirmar_no_permitido')

  revalidarAutorizaciones()
  return ok({ administracion_id: row.id })
}
