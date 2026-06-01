import 'server-only'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { fail, ok, type ActionResult, type AmbitoEvento } from '../types'

/** Fecha de hoy en huso Europe/Madrid como 'YYYY-MM-DD' (mismo criterio que las
 *  páginas de calendario). Usado para la ventana de confirmación (D12). */
export function hoyMadridYmd(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // en-CA da 'YYYY-MM-DD'.
  return fmt.format(new Date())
}

/** Revalida las tres vistas de calendario tras crear/editar/cancelar un evento. */
export function revalidarCalendario(): void {
  revalidatePath('/[locale]/admin/calendario', 'page')
  revalidatePath('/[locale]/teacher/calendario', 'page')
  revalidatePath('/[locale]/family/calendario', 'page')
}

/**
 * Resuelve el `centro_id` server-side según el ámbito (db-triggers.md: nunca
 * sentinel). nino→`ninos.centro_id`; aula→`aulas.centro_id`; centro→centro del
 * usuario autenticado (`roles_usuario`, primer rol activo; single-centro en el piloto).
 */
export async function resolverCentroIdEvento(
  supabase: SupabaseClient<Database>,
  userId: string,
  ambito: AmbitoEvento,
  ninoId: string | null,
  aulaId: string | null
): Promise<ActionResult<string>> {
  if (ambito === 'nino') {
    const { data: nino, error } = await supabase
      .from('ninos')
      .select('centro_id')
      .eq('id', ninoId!)
      .maybeSingle()
    if (error) {
      logger.warn('eventos: ninos.select', error.message)
      return fail('eventos.errors.creacion_fallo')
    }
    if (!nino) return fail('eventos.errors.nino_no_encontrado')
    return ok(nino.centro_id)
  }

  if (ambito === 'aula') {
    const { data: aula, error } = await supabase
      .from('aulas')
      .select('centro_id')
      .eq('id', aulaId!)
      .maybeSingle()
    if (error) {
      logger.warn('eventos: aulas.select', error.message)
      return fail('eventos.errors.creacion_fallo')
    }
    if (!aula) return fail('eventos.errors.aula_no_encontrada')
    return ok(aula.centro_id)
  }

  // centro → centro del usuario.
  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!data?.centro_id) return fail('eventos.errors.sin_centro')
  return ok(data.centro_id)
}
