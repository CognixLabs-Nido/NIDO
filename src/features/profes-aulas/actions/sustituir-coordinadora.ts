'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { sustituirCoordinadoraSchema, type SustituirCoordinadoraInput } from '../schemas/profe-aula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Relevo de coordinadora en un aula (ADR-0034).
 *
 * Orden SEGURO para no violar el índice único parcial
 * `idx_un_coordinadora_activa_por_aula`:
 *   1. Degradar PRIMERO la coordinadora activa actual a `profesora` (si la hay).
 *   2. Promocionar DESPUÉS la asignación nueva a `coordinadora`.
 *
 * Degradar antes de promocionar garantiza que en ningún instante hay dos
 * coordinadoras activas. El `23505` queda como red de seguridad de carrera
 * (dos admins relevando a la vez): se mapea a un error claro.
 *
 * No es una transacción estricta: una interrupción entre ambos UPDATE deja
 * el aula sin coordinadora, un estado VÁLIDO y reparable con un clic (no
 * justifica una RPC SQL — ver ADR-0034).
 *
 * Ambas escrituras corren bajo RLS `profes_aulas_admin_all` con la sesión
 * del admin: solo afectan a filas de su centro.
 */
export async function sustituirCoordinadora(
  input: SustituirCoordinadoraInput
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const r = await sustituirCoordinadoraCore(supabase, input)
  if (r.success) revalidatePath('/[locale]/admin/aulas', 'page')
  return r
}

/** Núcleo testeable (cliente inyectable; sin `revalidatePath`). */
export async function sustituirCoordinadoraCore(
  supabase: SupabaseClient<Database>,
  input: SustituirCoordinadoraInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = sustituirCoordinadoraSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'profeAula.validation.invalid')
  }
  const { aula_id, nueva_asignacion_id } = parsed.data

  // 1. Coordinadora activa actual del aula (si existe y no es la propia nueva).
  const { data: actual, error: lookupErr } = await supabase
    .from('profes_aulas')
    .select('id')
    .eq('aula_id', aula_id)
    .eq('tipo_personal_aula', 'coordinadora')
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (lookupErr) {
    logger.warn('sustituirCoordinadora lookup error', lookupErr.message)
    return fail('profeAula.errors.sustituir_fallo')
  }

  if (actual && actual.id !== nueva_asignacion_id) {
    const { error: degradarErr } = await supabase
      .from('profes_aulas')
      .update({ tipo_personal_aula: 'profesora' })
      .eq('id', actual.id)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    if (degradarErr) {
      logger.warn('sustituirCoordinadora degradar error', degradarErr.message)
      return fail('profeAula.errors.sustituir_fallo')
    }
  }

  // 2. Promocionar la nueva. Filtramos por aula_id para no promocionar una
  //    fila de otra aula por error.
  const { data: promovida, error: promoverErr } = await supabase
    .from('profes_aulas')
    .update({ tipo_personal_aula: 'coordinadora' })
    .eq('id', nueva_asignacion_id)
    .eq('aula_id', aula_id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (promoverErr) {
    logger.warn('sustituirCoordinadora promover error', promoverErr.message)
    if (promoverErr.code === '23505') return fail('profeAula.errors.ya_principal')
    return fail('profeAula.errors.sustituir_fallo')
  }
  if (!promovida) return fail('profeAula.errors.asignacion_no_encontrada')

  return ok({ id: promovida.id })
}
