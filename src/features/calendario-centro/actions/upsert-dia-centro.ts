'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { upsertDiaCentroSchema, type UpsertDiaCentroInput } from '../schemas/dia-centro'
import { fail, ok, type ActionResult } from '../types'

/**
 * Upsert idempotente para `dias_centro`. RLS impone admin del centro;
 * el ON CONFLICT (centro_id, fecha) DO UPDATE permite cambiar el tipo
 * de un día ya marcado sin tener que borrar y recrear.
 *
 * `creado_por` se setea en INSERT pero NO en UPDATE — preservamos quién
 * creó el override originalmente. Si se prefiere "última edición", se
 * deriva de `audit_log` (cada cambio queda allí con `usuario_id`).
 *
 * Esta acción NO usa `dentro_de_ventana_edicion` — el calendario laboral
 * es planificación y se puede editar para cualquier fecha (ADR-0019).
 */
export async function upsertDiaCentro(
  input: UpsertDiaCentroInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = upsertDiaCentroSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'calendario.toasts.error_guardar')
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id ?? null

  // Estrategia: INSERT con ON CONFLICT que actualiza tipo + observaciones
  // pero deja `creado_por` igual (sólo lo asignamos en INSERT). Hacerlo
  // con `upsert()` de supabase-js dejaría `creado_por` sobreescrito en
  // UPDATE. Lo hacemos en dos pasos:
  //  1) intentar UPDATE
  //  2) si no afectó filas, INSERT con `creado_por = uid()`
  const { data: existente } = await supabase
    .from('dias_centro')
    .select('id')
    .eq('centro_id', parsed.data.centro_id)
    .eq('fecha', parsed.data.fecha)
    .maybeSingle()

  let id: string | undefined

  if (existente) {
    const { error: updErr } = await supabase
      .from('dias_centro')
      .update({
        tipo: parsed.data.tipo,
        observaciones: parsed.data.observaciones,
      })
      .eq('id', existente.id)
    if (updErr) {
      logger.warn('upsertDiaCentro update failed', updErr.message)
      return fail('calendario.toasts.error_guardar')
    }
    id = existente.id
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('dias_centro')
      .insert({
        centro_id: parsed.data.centro_id,
        fecha: parsed.data.fecha,
        tipo: parsed.data.tipo,
        observaciones: parsed.data.observaciones,
        creado_por: userId,
      })
      .select('id')
      .single()
    if (insErr || !ins) {
      logger.warn('upsertDiaCentro insert failed', insErr?.message)
      return fail('calendario.toasts.error_guardar')
    }
    id = ins.id
  }

  revalidatePath('/[locale]/admin/calendario', 'page')
  revalidatePath('/[locale]/teacher/calendario', 'page')
  revalidatePath('/[locale]/family/calendario', 'page')
  revalidatePath('/[locale]/family', 'page')
  revalidatePath('/[locale]/teacher', 'page')

  return ok({ id: id! })
}
