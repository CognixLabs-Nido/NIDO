import 'server-only'

import { revalidatePath } from 'next/cache'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { fail, ok, type ActionResult, type TipoCita } from '../types'

/** Fecha de hoy en huso Europe/Madrid como 'YYYY-MM-DD' (ventana de RSVP, AG-11). */
export function hoyMadridYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Revalida la vista de la Agenda (ruta top-level cross-rol). */
export function revalidarAgenda(): void {
  revalidatePath('/[locale]/agenda', 'page')
}

/**
 * ¿La cita ya comenzó (huso Madrid)? Cierra la ventana de RSVP/edición (AG-11).
 * Compara 'YYYY-MM-DD HH:MM' lexicográficamente (ambos zero-padded).
 */
export function citaYaComenzo(fecha: string, horaInicio: string): boolean {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const ahora = partes.replace(', ', ' ') // 'YYYY-MM-DD HH:MM'
  const inicio = `${fecha} ${horaInicio.slice(0, 5)}`
  return ahora >= inicio
}

/**
 * ¿El llamante puede **gestionar** (editar/cancelar/añadir/quitar) la cita?
 * Organizador o admin del centro (AG-11). Espejo de la RLS `citas_update` /
 * `cita_invitados_*`. Se usa como least-privilege antes de lecturas con service
 * role; la RLS de la escritura sigue siendo el gate real.
 */
export async function puedeGestionarCita(
  supabase: SupabaseClient<Database>,
  organizadorId: string,
  centroId: string,
  userId: string
): Promise<boolean> {
  if (organizadorId === userId) return true
  const { data } = await supabase.rpc('es_admin', { p_centro_id: centroId })
  return data === true
}

/**
 * Resuelve el `centro_id` server-side (db-triggers.md: nunca sentinel).
 *  - `reunion_familia` → `ninos.centro_id` del `nino_id`.
 *  - `reunion_clase`   → `aulas.centro_id` del `aula_id`.
 *  - `reunion_claustro` / `visita` → centro del organizador (`roles_usuario`,
 *    primer rol activo; single-centro en el piloto). El trigger BD NO puede
 *    derivarlo en estos dos tipos (no hay niño/aula), por eso el action lo pasa
 *    explícito; para familia/clase el trigger queda como red de seguridad.
 */
export async function resolverCentroIdCita(
  supabase: SupabaseClient<Database>,
  userId: string,
  tipo: TipoCita,
  ninoId: string | null,
  aulaId: string | null
): Promise<ActionResult<string>> {
  if (tipo === 'reunion_familia') {
    const { data: nino, error } = await supabase
      .from('ninos')
      .select('centro_id')
      .eq('id', ninoId!)
      .maybeSingle()
    if (error) {
      logger.warn('citas: ninos.select', error.message)
      return fail('citas.errors.creacion_fallo')
    }
    if (!nino) return fail('citas.errors.nino_no_encontrado')
    return ok(nino.centro_id)
  }

  if (tipo === 'reunion_clase') {
    const { data: aula, error } = await supabase
      .from('aulas')
      .select('centro_id')
      .eq('id', aulaId!)
      .maybeSingle()
    if (error) {
      logger.warn('citas: aulas.select', error.message)
      return fail('citas.errors.creacion_fallo')
    }
    if (!aula) return fail('citas.errors.aula_no_encontrada')
    return ok(aula.centro_id)
  }

  // reunion_claustro / visita → centro del organizador.
  const { data } = await supabase
    .from('roles_usuario')
    .select('centro_id')
    .eq('usuario_id', userId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (!data?.centro_id) return fail('citas.errors.sin_centro')
  return ok(data.centro_id)
}

/**
 * ¿El llamante (auth.uid()) puede organizar esta cita? **Espejo de la RLS
 * `citas_insert`**, evaluado en el action ANTES de las lecturas privilegiadas
 * (service role) del snapshot — least-privilege: no expandimos invitados para un
 * llamante que el INSERT va a rechazar igual. La RLS sigue siendo el gate real.
 *
 * La coherencia `centro_de_nino/aula = centro_id` no se re-chequea: `centro_id`
 * se derivó precisamente del niño/aula en `resolverCentroIdCita`.
 */
export async function puedeOrganizarCita(
  supabase: SupabaseClient<Database>,
  tipo: TipoCita,
  centroId: string,
  ninoId: string | null,
  aulaId: string | null
): Promise<boolean> {
  const { data: esAdmin } = await supabase.rpc('es_admin', { p_centro_id: centroId })
  if (esAdmin === true) return true

  // Profe solo organiza reunion_familia (de su niño) y reunion_clase (de su aula).
  if (tipo === 'reunion_familia' && ninoId) {
    const { data } = await supabase.rpc('es_profe_de_nino', { p_nino_id: ninoId })
    return data === true
  }
  if (tipo === 'reunion_clase' && aulaId) {
    const { data } = await supabase.rpc('es_profe_de_aula', { p_aula_id: aulaId })
    return data === true
  }
  // reunion_claustro / visita → solo admin (ya descartado arriba).
  return false
}
