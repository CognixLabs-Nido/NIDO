'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { moverProfeAulaSchema, type MoverProfeAulaInput } from '../schemas/profe-aula'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Mueve a una persona de un aula a otra.
 *
 * ATOMICIDAD (Nota D del Checkpoint B): se hace el INSERT en el aula
 * destino PRIMERO y solo si tiene éxito se cierra el origen con `fecha_fin`.
 * Este orden garantiza que la persona nunca queda "sin aula" si algo falla:
 *
 *   - Si la persona ya está activa en el destino → se aborta ANTES de tocar
 *     el origen (no hay constraint que lo impida en BD, así que lo
 *     comprobamos explícitamente para no crear un duplicado).
 *   - Si el INSERT en destino falla → se devuelve error sin tocar el origen.
 *   - Solo tras un INSERT correcto se aplica el `fecha_fin` al origen.
 *
 * El tipo en el aula destino se reinicia a `profesora` si en el origen era
 * `coordinadora` (un traslado no arrastra la jefatura del aula nueva; además
 * evitaría el índice único si el destino ya tuviera coordinadora). El resto
 * de tipos (tecnico/apoyo/profesora) se preservan.
 *
 * RLS `profes_aulas_admin_all` aplica a ambas escrituras.
 */
export async function moverProfeAula(
  input: MoverProfeAulaInput
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const r = await moverProfeAulaCore(supabase, input)
  if (r.success) revalidatePath('/[locale]/admin/aulas', 'page')
  return r
}

/** Núcleo testeable (cliente inyectable; sin `revalidatePath`). */
export async function moverProfeAulaCore(
  supabase: SupabaseClient<Database>,
  input: MoverProfeAulaInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = moverProfeAulaSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'profeAula.validation.invalid')
  }
  const { asignacion_id, aula_destino_id } = parsed.data

  // Origen: debe existir y estar activo.
  const { data: origen, error: origenErr } = await supabase
    .from('profes_aulas')
    .select('id, profe_id, aula_id, tipo_personal_aula')
    .eq('id', asignacion_id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (origenErr) {
    logger.warn('moverProfeAula origen error', origenErr.message)
    return fail('profeAula.errors.mover_fallo')
  }
  if (!origen) return fail('profeAula.errors.asignacion_no_encontrada')
  if (origen.aula_id === aula_destino_id) return fail('profeAula.errors.mover_mismo_aula')

  // ¿Ya está activa en el destino? Abortar sin tocar el origen.
  const { data: yaEnDestino, error: dupErr } = await supabase
    .from('profes_aulas')
    .select('id')
    .eq('profe_id', origen.profe_id)
    .eq('aula_id', aula_destino_id)
    .is('fecha_fin', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (dupErr) {
    logger.warn('moverProfeAula dup-check error', dupErr.message)
    return fail('profeAula.errors.mover_fallo')
  }
  if (yaEnDestino) return fail('profeAula.errors.mover_ya_en_destino')

  const tipoDestino =
    origen.tipo_personal_aula === 'coordinadora' ? 'profesora' : origen.tipo_personal_aula

  // 1. INSERT destino primero.
  const { data: insertada, error: insertErr } = await supabase
    .from('profes_aulas')
    .insert({
      profe_id: origen.profe_id,
      aula_id: aula_destino_id,
      fecha_inicio: hoyMadrid(),
      tipo_personal_aula: tipoDestino,
    })
    .select('id')
    .single()

  if (insertErr || !insertada) {
    logger.warn('moverProfeAula insert destino error', insertErr?.message)
    return fail('profeAula.errors.mover_fallo')
  }

  // 2. Cerrar el origen solo tras un INSERT correcto.
  const { error: cerrarErr } = await supabase
    .from('profes_aulas')
    .update({ fecha_fin: hoyMadrid() })
    .eq('id', origen.id)
    .is('fecha_fin', null)

  if (cerrarErr) {
    // El destino quedó creado; el origen sigue activo. Estado válido
    // (la persona está en ambas), reparable retirando el origen a mano.
    logger.warn('moverProfeAula cerrar origen error', cerrarErr.message)
    return fail('profeAula.errors.mover_origen_no_cerrado')
  }

  return ok({ id: insertada.id })
}
