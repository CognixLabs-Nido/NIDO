'use server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { hoyMadridYmd, revalidarCalendario } from '../lib/server-helpers'
import { confirmarAsistenciaSchema, type ConfirmarAsistenciaInput } from '../schemas/eventos'
import { fail, ok, type ActionResult } from '../types'

/**
 * La familia confirma / rechaza la asistencia de un niño a un evento (D2/D9).
 * UPSERT idempotente por `(evento_id, nino_id)`, last-write-wins. RLS
 * (`confirmaciones_*`) asegura: solo un tutor del niño, sobre un evento que lo
 * incluye, y `confirmado_por = auth.uid()`. Ventana hasta la fecha de inicio (D12).
 *
 * **Asistencia ligera, no autorización legal** (D13): sin firma ni consentimiento
 * (eso es F8). El audit NO cubre confirmaciones.
 */
export async function confirmarAsistencia(
  input: ConfirmarAsistenciaInput
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return fail('eventos.errors.no_autorizado')

  const result = await confirmarAsistenciaCore(supabase, userId, input)
  if (result.success) revalidarCalendario()
  return result
}

/** Núcleo testeable: cliente + userId explícitos, sin revalidate. */
export async function confirmarAsistenciaCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: ConfirmarAsistenciaInput
): Promise<ActionResult<void>> {
  const parsed = confirmarAsistenciaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'eventos.errors.confirmacion_fallo')
  }
  const d = parsed.data

  // Ventana (D12) + estado del evento. RLS de SELECT ya filtra por audiencia:
  // si el tutor no es audiencia, no lo ve → no_encontrado.
  const { data: evento, error: evErr } = await supabase
    .from('eventos')
    .select('fecha, estado, requiere_confirmacion')
    .eq('id', d.evento_id)
    .maybeSingle()

  if (evErr) {
    logger.warn('confirmarAsistencia: eventos.select', evErr.message)
    return fail('eventos.errors.confirmacion_fallo')
  }
  if (!evento) return fail('eventos.errors.no_encontrado')
  if (evento.estado === 'cancelado') return fail('eventos.errors.evento_cancelado')
  if (!evento.requiere_confirmacion) return fail('eventos.errors.no_requiere_confirmacion')
  if (hoyMadridYmd() > evento.fecha) return fail('eventos.errors.ventana_cerrada')

  const { data: upserted, error } = await supabase
    .from('confirmaciones_evento')
    .upsert(
      {
        evento_id: d.evento_id,
        nino_id: d.nino_id,
        estado: d.estado,
        comentario: d.comentario ?? null,
        confirmado_por: userId,
        confirmado_at: new Date().toISOString(),
      },
      { onConflict: 'evento_id,nino_id' }
    )
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('confirmarAsistencia: upsert', error.message)
    if (error.code === '42501') return fail('eventos.errors.no_autorizado')
    return fail('eventos.errors.confirmacion_fallo')
  }
  if (!upserted) return fail('eventos.errors.no_autorizado')

  return ok(undefined)
}
