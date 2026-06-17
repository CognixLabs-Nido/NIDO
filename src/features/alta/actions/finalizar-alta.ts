'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'

const ninoIdSchema = z.string().uuid()

/**
 * Pieza 3c — el TUTOR LEGAL finaliza el alta de su hijo: la matrícula pasa de
 * `'pendiente'` a `'lista'` (cola de validación de la dirección). Lo hace vía la RPC
 * `marcar_matricula_lista` (SECURITY DEFINER, gate `es_tutor_legal_de`), porque la RLS
 * de `matriculas` deja UPDATE solo al admin.
 *
 * Valida la identidad (nombre + fecha) ANTES de llamar a la RPC, para dar un mensaje
 * claro; la RPC además lo enforza como backstop (llamadas directas por PostgREST).
 * Idempotente: re-finalizar estando ya `'lista'` es no-op (la RPC devuelve null) y se
 * trata como éxito — permite "editar mientras espera a la directora" (cada paso ya
 * persiste por su cuenta).
 */
export async function finalizarAlta(ninoId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('alta.errors.finalizar_fallo')

  const supabase = await createClient()

  // Identidad obligatoria (mensaje claro; la RPC es el backstop real).
  const { data: nino } = await supabase
    .from('ninos')
    .select('apellidos, fecha_nacimiento')
    .eq('id', parsed.data)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return fail('alta.errors.finalizar_fallo')
  if (!nino.apellidos || !nino.fecha_nacimiento) return fail('alta.errors.identidad_incompleta')

  const { error } = await supabase.rpc('marcar_matricula_lista', { p_nino_id: parsed.data })
  if (error) {
    logger.warn('finalizarAlta', error.message)
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.errors.finalizar_fallo')
  }

  // null (no había 'pendiente') = idempotente: ya estaba 'lista'/'activa' → éxito.
  return ok({ id: parsed.data })
}
