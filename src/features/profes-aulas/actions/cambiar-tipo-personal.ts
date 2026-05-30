'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { cambiarTipoPersonalSchema, type CambiarTipoPersonalInput } from '../schemas/profe-aula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Cambia el `tipo_personal_aula` de una asignación activa.
 *
 * Para los tipos no-coordinadora (profesora/tecnico/apoyo) es un UPDATE
 * directo. Para `coordinadora`, si el aula YA tiene otra coordinadora
 * activa, el índice único parcial dispara `23505`: aquí lo mapeamos a un
 * error claro y la UI debe encaminar ese caso por `sustituirCoordinadora`
 * (que degrada la actual antes de promocionar) en vez de por esta action.
 * Mantener el `23505` como contrato cubre además la carrera entre dos
 * admins (ver ADR-0034).
 *
 * RLS `profes_aulas_admin_all` limita el UPDATE a filas del centro del
 * admin. 0 filas afectadas → `data === null` → asignación no encontrada.
 */
export async function cambiarTipoPersonal(
  input: CambiarTipoPersonalInput
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const r = await cambiarTipoPersonalCore(supabase, input)
  if (r.success) revalidatePath('/[locale]/admin/aulas', 'page')
  return r
}

/** Núcleo testeable (cliente inyectable; sin `revalidatePath`). */
export async function cambiarTipoPersonalCore(
  supabase: SupabaseClient<Database>,
  input: CambiarTipoPersonalInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = cambiarTipoPersonalSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'profeAula.validation.invalid')
  }

  const { data, error } = await supabase
    .from('profes_aulas')
    .update({ tipo_personal_aula: parsed.data.tipo_personal_aula })
    .eq('id', parsed.data.asignacion_id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('cambiarTipoPersonal error', error.message)
    if (error.code === '23505') return fail('profeAula.errors.ya_principal')
    return fail('profeAula.errors.cambiar_tipo_fallo')
  }
  if (!data) return fail('profeAula.errors.asignacion_no_encontrada')

  return ok({ id: data.id })
}
