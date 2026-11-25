'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { agendaCabeceraInputSchema, type AgendaCabeceraInput } from '../schemas/agenda-diaria'
import { fail, ok, type ActionResult } from '../types'

/**
 * Crea o actualiza la fila padre `agendas_diarias` para (nino_id, fecha).
 * Es idempotente: el `onConflict` por la UNIQUE(nino_id, fecha) hace UPDATE
 * si ya existe. Las RLS de INSERT/UPDATE exigen ventana de edición.
 */
export async function upsertAgendaCabecera(
  input: AgendaCabeceraInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = agendaCabeceraInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'agenda.errors.guardar_fallo')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agendas_diarias')
    .upsert(
      {
        nino_id: parsed.data.nino_id,
        fecha: parsed.data.fecha,
        estado_general: parsed.data.estado_general,
        humor: parsed.data.humor,
        observaciones_generales: parsed.data.observaciones_generales,
      },
      { onConflict: 'nino_id,fecha' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('upsertAgendaCabecera failed', error?.message)
    if (error?.code === '42501' || error?.message.includes('row-level security')) {
      return fail('agenda.errors.fuera_de_ventana')
    }
    return fail('agenda.errors.guardar_fallo')
  }

  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return ok({ id: data.id })
}

/** Por qué no hay agenda: el motivo de verdad, para que el llamador no diga otro. */
export type MotivoSinAgenda = 'lectura_fallida' | 'fuera_de_ventana' | 'guardar_fallo'

/**
 * Helper interno: asegura que existe una fila padre para (nino_id, fecha) y devuelve su id, o el motivo
 * de que no la haya. Censo C (decisión de Jose del 2026-11-25): antes devolvía null en cualquier fallo y
 * los cinco llamadores decían «Ya no puedes editar este día», también cuando no se pudo LEER o el insert
 * falló por otra cosa.
 *   · Si la lectura falla se intenta el insert igual: con el día sin agenda, eso guarda, y es verdad.
 *   · Si el insert choca (23505), la agenda ya estaba (la lectura falló, o otra profe la creó a la vez):
 *     se relee una vez; si tampoco se puede, `lectura_fallida`.
 *   · 42501 / RLS: `fuera_de_ventana`, el único caso en que lo es. Cualquier otro: `guardar_fallo`.
 */
export async function asegurarAgenda(
  ninoId: string,
  fecha: string
): Promise<{ id: string } | { motivo: MotivoSinAgenda }> {
  const supabase = await createClient()
  const leer = () =>
    supabase
      .from('agendas_diarias')
      .select('id')
      .eq('nino_id', ninoId)
      .eq('fecha', fecha)
      .maybeSingle()

  const { data: existing, error: errorLectura } = await leer()
  if (errorLectura) logger.warn('asegurarAgenda: lectura', errorLectura.code ?? 'sin_codigo')
  if (existing?.id) return { id: existing.id }

  const { data, error } = await supabase
    .from('agendas_diarias')
    .insert({ nino_id: ninoId, fecha })
    .select('id')
    .single()
  if (data && !error) return { id: data.id }

  logger.warn('asegurarAgenda: insert', error?.code ?? 'sin_codigo')
  if (error?.code === '42501' || error?.message.includes('row-level security')) {
    return { motivo: 'fuera_de_ventana' }
  }
  if (error?.code === '23505') {
    const { data: releida, error: errorRelectura } = await leer()
    if (releida?.id) return { id: releida.id }
    if (errorRelectura) return { motivo: 'lectura_fallida' }
  }
  return { motivo: 'guardar_fallo' }
}

/** La clave de error de un motivo, para los cuatro llamadores de la agenda. */
export async function claveSinAgenda(motivo: MotivoSinAgenda): Promise<string> {
  if (motivo === 'lectura_fallida') return 'common.lectura_fallida'
  return `agenda.errors.${motivo}`
}
